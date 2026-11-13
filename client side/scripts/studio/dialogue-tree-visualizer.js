import debug from '../debug.js';

class DialogueTreeVisualizer {
    constructor(containerId, options = {}) {
        this.containerId = containerId;
        this.container = document.getElementById(containerId);
        this.svg = null;
        this.edgesGroup = null;
        this.nodesGroup = null;
        this.nodesContainer = null;
        
        this.nodes = new Map();
        this.edges = [];
        this.data = {
            conversations: [],
            branches: [],
            choices: [],
            characters: []
        };
        
        this.options = {
            nodeWidth: 200,
            nodeHeight: 80,
            rankSeparation: 100,
            nodeSeparation: 60,
            ...options
        };
        
        this.state = {
            zoom: 1,
            panX: 0,
            panY: 0,
            selectedNodeId: null,
            connectingFrom: null,
            cutting: false,
            pointer: null,
            placing: null,      // { edgeId, point } — ставится перемычка на связь
            dragPoint: null,    // { edgeId, index } — перетаскивается перемычка
            isDragging: false,
            dragNode: null,
            dragOffsetX: 0,
            dragOffsetY: 0,
            isPanning: false,
            panStartX: 0,
            panStartY: 0
        };
        
        this.callbacks = {
            onNodeClick: null,
            onNodeEdit: null,
            onNodeDelete: null,
            onConnectionCreate: null,
            onNodeAdd: null,
            onNodeAddBefore: null,
            onNodeUnlink: null,
            onEdgeCut: null,
            onEdgePointsChange: null
        };
        // Перемычки связей: edgeKey → [{ dx, dy }] от нижней середины исходной реплики.
        this.edgePoints = {};
        
        this.contextMenu = null;
        
        this.init();
    }
    
    init() {
        this.svg = document.getElementById('dialogue-tree-svg');
        this.edgesGroup = document.getElementById('tree-edges');
        this.nodesContainer = document.getElementById('dialogue-tree-nodes-container');
        
        if (!this.svg || !this.edgesGroup || !this.nodesContainer) {
            console.error('DialogueTreeVisualizer: Required DOM elements not found');
            return;
        }
        
        this.setupEventListeners();
    }
    
    setupEventListeners() {
        this.container.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        this.container.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        this.container.addEventListener('mouseup', (e) => this.handleMouseUp(e));
        this.container.addEventListener('wheel', (e) => this.handleWheel(e));
        this.container.addEventListener('contextmenu', (e) => this.handleContextMenu(e));

        // Esc отменяет протягивание связи и ножницы.
        document.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape') return;
            if (this.state.connectingFrom) this.cancelConnecting();
            if (this.state.cutting) this.cancelCutting();
            if (this.state.placing) this.cancelPlacing();
        });

        // У каждой связи — невидимая широкая «зона попадания»: наведение, ножницы, двойной клик.
        this.edgesGroup.addEventListener('mouseover', (e) => this.hoverEdge(e.target.closest?.('.tree-edge-hit'), true));
        this.edgesGroup.addEventListener('mouseout', (e) => this.hoverEdge(e.target.closest?.('.tree-edge-hit'), false));
        // Двойной клик по связи — поставить перемычку: кружок едет по линии, ЛКМ ставит, ПКМ отменяет.
        this.edgesGroup.addEventListener('dblclick', (e) => {
            const hit = e.target.closest?.('.tree-edge-hit');
            if (!hit || this.state.cutting || this.state.connectingFrom) return;
            e.preventDefault();
            e.stopPropagation();
            this.startPlacing(hit.dataset.edgeId, e);
        });
        this.edgesGroup.addEventListener('click', (e) => {
            const hit = e.target.closest?.('.tree-edge-hit');
            if (hit && this.state.cutting) {
                e.stopPropagation();
                this.cutEdge(hit.dataset.edgeId);
            }
        });
        
        document.addEventListener('click', (e) => {
            if (this.contextMenu && !this.contextMenu.contains(e.target)) {
                this.hideContextMenu();
            }
        });
        
        document.getElementById('zoom-in-btn')?.addEventListener('click', () => this.zoomIn());
        document.getElementById('zoom-out-btn')?.addEventListener('click', () => this.zoomOut());
        document.getElementById('zoom-fit-btn')?.addEventListener('click', () => this.zoomToFit());
        document.getElementById('auto-layout-btn')?.addEventListener('click', () => this.autoLayout());
    }
    
    setData(data) {
        this.edgePoints = data.edgePoints ? JSON.parse(JSON.stringify(data.edgePoints)) : {};
        this.data = {
            conversations: data.conversations || [],
            branches: data.branches || [],
            choices: data.choices || [],
            characters: data.characters || []
        };
        
        this.buildGraph();
        this.render();
    }
    
    buildGraph() {
        this.nodes.clear();
        this.edges = [];
        
        const branchMap = new Map();
        this.data.branches.forEach(b => {
            branchMap.set(b.branch_id, []);
        });
        
        const conversationsByBranch = new Map();
        this.data.conversations.forEach(conv => {
            const branchId = conv.branch_id || 'main';
            if (!conversationsByBranch.has(branchId)) {
                conversationsByBranch.set(branchId, []);
            }
            conversationsByBranch.get(branchId).push(conv);
        });
        
        conversationsByBranch.forEach((convs, branchId) => {
            convs.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
        });
        
        this.data.conversations.forEach(conv => {
            const char = this.data.characters.find(c => c.id === conv.character_id);
            const choices = this.data.choices.filter(ch => ch.conversation_id === conv.id);
            
            const nodeData = {
                id: `conv_${conv.id}`,
                conversationId: conv.id,
                speaker: char ? char.name : 'Система',
                text: conv.text,
                branchId: conv.branch_id || 'main',
                sortOrder: conv.sort_order || 0,
                hasChoice: choices.length > 0,
                choices: choices,
                variantAudiences: conv.variant_audiences || [],
                x: 0,
                y: 0
            };
            
            this.nodes.set(nodeData.id, nodeData);
        });
        
        this.buildSequentialEdges(conversationsByBranch);
        this.buildChoiceEdges();
    }
    
    buildSequentialEdges(conversationsByBranch) {
        conversationsByBranch.forEach((convs, branchId) => {
            for (let i = 0; i < convs.length - 1; i++) {
                const fromId = `conv_${convs[i].id}`;
                const toId = `conv_${convs[i + 1].id}`;
                
                if (this.nodes.has(fromId) && this.nodes.has(toId)) {
                    const fromNode = this.nodes.get(fromId);
                    if (fromNode.hasChoice) {
                        continue;
                    }
                    
                    this.edges.push({
                        id: `edge_${fromId}_${toId}`,
                        key: `seq:${convs[i].id}:${convs[i + 1].id}`,
                        source: fromId,
                        target: toId,
                        type: 'sequential'
                    });
                }
            }
        });
    }
    
    buildChoiceEdges() {
        this.data.choices.forEach(choice => {
            if (choice.target_branch) {
                const sourceId = `conv_${choice.conversation_id}`;
                const targetConvs = this.data.conversations.filter(
                    c => c.branch_id === choice.target_branch
                );
                
                if (targetConvs.length > 0) {
                    targetConvs.sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
                    const targetId = `conv_${targetConvs[0].id}`;
                    
                    if (this.nodes.has(sourceId) && this.nodes.has(targetId)) {
                        const existingEdge = this.edges.find(
                            e => e.source === sourceId && e.target === targetId
                        );
                        
                        if (!existingEdge) {
                            this.edges.push({
                                id: `choice_${choice.id}`,
                                source: sourceId,
                                target: targetId,
                                type: 'choice',
                                key: `choice:${choice.id}`,
                                choiceOptionId: choice.id,
                                label: choice.option_text
                            });
                        }
                    }
                }
            }
        });
    }
    
    // Связные части графа (без учёта направления).
    components() {
        const neighbours = new Map([...this.nodes.keys()].map(id => [id, []]));
        this.edges.forEach(e => {
            if (!neighbours.has(e.source) || !neighbours.has(e.target)) return;
            neighbours.get(e.source).push(e.target);
            neighbours.get(e.target).push(e.source);
        });
        const seen = new Set();
        const result = [];
        this.nodes.forEach((_, start) => {
            if (seen.has(start)) return;
            const ids = [];
            const stack = [start];
            seen.add(start);
            while (stack.length) {
                const id = stack.pop();
                ids.push(id);
                neighbours.get(id).forEach(n => { if (!seen.has(n)) { seen.add(n); stack.push(n); } });
            }
            result.push(ids);
        });
        // Родительское дерево — то, где начинается диалог (первая реплика главной ветки) — идёт первым;
        // отрезанные части — правее, в порядке создания реплик.
        const rootId = this.rootNodeId();
        const firstConv = ids => Math.min(...ids.map(id => this.nodes.get(id).conversationId));
        return result.sort((a, b) => {
            if (a.includes(rootId)) return -1;
            if (b.includes(rootId)) return 1;
            return firstConv(a) - firstConv(b);
        });
    }

    rootNodeId() {
        const main = [...this.nodes.values()].filter(n => n.branchId === 'main')
            .sort((a, b) => a.sortOrder - b.sortOrder || a.conversationId - b.conversationId);
        if (main.length) return main[0].id;
        const any = [...this.nodes.values()].sort((a, b) => a.conversationId - b.conversationId);
        return any[0]?.id;
    }

    // Раскладка одного дерева: позиции относительно (0, 0) и размеры.
    layoutComponent(ids) {
        const set = new Set(ids);
        const edges = this.edges.filter(e => set.has(e.source) && set.has(e.target));
        const positions = new Map();
        const { nodeWidth: w, nodeHeight: h } = this.options;

        if (typeof dagre !== 'undefined') {
            const g = new dagre.graphlib.Graph();
            g.setGraph({ rankdir: 'TB', ranksep: this.options.rankSeparation, nodesep: this.options.nodeSeparation, marginx: 0, marginy: 0 });
            g.setDefaultEdgeLabel(() => ({}));
            ids.forEach(id => g.setNode(id, { width: w, height: this.nodeHeight(this.nodes.get(id)) }));
            edges.forEach(e => g.setEdge(e.source, e.target));
            dagre.layout(g);
            ids.forEach(id => { const n = g.node(id); positions.set(id, { x: n.x - w / 2, y: n.y - n.height / 2 }); });
        } else {
            // dagre с CDN не загрузился — уровни от корней, узлы уровня в ряд.
            const incoming = new Map(ids.map(id => [id, 0]));
            const children = new Map(ids.map(id => [id, []]));
            edges.forEach(e => { incoming.set(e.target, incoming.get(e.target) + 1); children.get(e.source).push(e.target); });
            const level = new Map();
            const queue = ids.filter(id => incoming.get(id) === 0);
            if (!queue.length) queue.push(ids[0]);
            queue.forEach(id => level.set(id, 0));
            while (queue.length) {
                const id = queue.shift();
                children.get(id).forEach(c => { if (!level.has(c)) { level.set(c, level.get(id) + 1); queue.push(c); } });
            }
            let maxLevel = Math.max(0, ...level.values());
            ids.forEach(id => { if (!level.has(id)) level.set(id, ++maxLevel); });
            const rows = new Map();
            level.forEach((lvl, id) => { if (!rows.has(lvl)) rows.set(lvl, []); rows.get(lvl).push(id); });
            const stepX = w + this.options.nodeSeparation;
            const stepY = h + this.options.rankSeparation;
            const widest = Math.max(...[...rows.values()].map(r => r.length));
            rows.forEach((row, lvl) => {
                const offset = (widest - row.length) * stepX / 2;
                row.forEach((id, i) => positions.set(id, { x: offset + i * stepX, y: lvl * stepY }));
            });
        }

        const xs = [...positions.values()].map(p => p.x);
        const ys = [...positions.values()].map(p => p.y);
        const minX = Math.min(...xs), minY = Math.min(...ys);
        positions.forEach(p => { p.x -= minX; p.y -= minY; });
        return { positions, width: Math.max(...xs) - minX + w };
    }

    autoLayout() {
        if (this.nodes.size === 0) return;
        const GAP = 160;
        let offsetX = 50;
        this.components().forEach(ids => {
            const { positions, width } = this.layoutComponent(ids);
            positions.forEach((p, id) => {
                const node = this.nodes.get(id);
                node.x = offsetX + p.x;
                node.y = 50 + p.y;
            });
            offsetX += width + GAP;
        });
        this.render();
        this.zoomToFit();
    }

    render() {
        // Сначала узлы: их реальная высота нужна, чтобы связь начиналась ровно у нижнего края.
        this.renderNodes();
        this.updateTransform();
    }

    nodeHeight(node) {
        return node.height || this.options.nodeHeight;
    }

    // Начало связи — нижняя середина исходной реплики (в координатах дерева).
    edgeAnchor(edge) {
        const source = this.nodes.get(edge.source);
        return { x: source.x + this.options.nodeWidth / 2, y: source.y + this.nodeHeight(source) };
    }

    // Точки связи в координатах дерева: начало, перемычки, конец (верх целевой реплики).
    edgeGeometry(edge) {
        const source = this.nodes.get(edge.source);
        const target = this.nodes.get(edge.target);
        if (!source || !target) return null;
        const start = this.edgeAnchor(edge);
        const end = { x: target.x + this.options.nodeWidth / 2, y: target.y };
        const points = (this.edgePoints[edge.key] || []).map(p => ({ x: start.x + p.dx, y: start.y + p.dy }));
        return { start, end, points };
    }

    toScreen(p) {
        return { x: p.x * this.state.zoom + this.state.panX, y: p.y * this.state.zoom + this.state.panY };
    }

    toLayout(e) {
        const rect = this.container.getBoundingClientRect();
        return {
            x: (e.clientX - rect.left - this.state.panX) / this.state.zoom,
            y: (e.clientY - rect.top - this.state.panY) / this.state.zoom
        };
    }

    // Без перемычек — плавная кривая; с перемычками — ломаная через них.
    edgePathD(geometry) {
        const s = this.toScreen(geometry.start);
        const t = this.toScreen(geometry.end);
        if (!geometry.points.length) {
            const midY = (s.y + t.y) / 2;
            return `M ${s.x} ${s.y} C ${s.x} ${midY}, ${t.x} ${midY}, ${t.x} ${t.y}`;
        }
        return [s, ...geometry.points.map(p => this.toScreen(p)), t]
            .map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' ');
    }

    renderEdges() {
        this.edgesGroup.innerHTML = '';
        const zoom = this.state.zoom;

        this.edges.forEach(edge => {
            const geometry = this.edgeGeometry(edge);
            if (!geometry) return;
            const d = this.edgePathD(geometry);

            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', d);
            path.setAttribute('class', `tree-edge ${edge.type === 'choice' ? 'choice-edge' : ''}`);
            path.setAttribute('data-edge-id', edge.id);
            path.setAttribute('marker-end', edge.type === 'choice' ? 'url(#arrowhead-choice)' : 'url(#arrowhead)');
            path.setAttribute('stroke-width', 2 * zoom);
            if (edge.type === 'choice') path.setAttribute('stroke-dasharray', `${5 * zoom}, ${3 * zoom}`);
            this.edgesGroup.appendChild(path);

            // Широкая невидимая копия — по ней ловятся наведение, ножницы и двойной клик.
            const hit = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            hit.setAttribute('d', d);
            hit.setAttribute('class', 'tree-edge-hit');
            hit.setAttribute('data-edge-id', edge.id);
            hit.setAttribute('stroke-width', Math.max(12, 14 * zoom));
            this.edgesGroup.appendChild(hit);

            if (edge.label) {
                // Подпись ответа — у первого отрезка (с перемычками) или посередине кривой.
                const s = this.toScreen(geometry.start);
                const n = this.toScreen(geometry.points[0] || geometry.end);
                const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                text.setAttribute('x', (s.x + n.x) / 2);
                text.setAttribute('y', (s.y + n.y) / 2 - 5 * zoom);
                text.setAttribute('class', 'tree-edge-label');
                text.setAttribute('text-anchor', 'middle');
                text.setAttribute('font-size', `${10 * zoom}px`);
                text.textContent = edge.label.length > 20 ? edge.label.substring(0, 20) + '...' : edge.label;
                this.edgesGroup.appendChild(text);
            }

            // Кружки перемычек: тянуть ЛКМ, убрать ПКМ.
            geometry.points.forEach((p, index) => {
                const sp = this.toScreen(p);
                const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                dot.setAttribute('cx', sp.x);
                dot.setAttribute('cy', sp.y);
                dot.setAttribute('r', Math.max(4, 6 * zoom));
                dot.setAttribute('class', `tree-reroute ${edge.type === 'choice' ? 'choice-reroute' : ''}`);
                dot.setAttribute('data-edge-id', edge.id);
                dot.setAttribute('data-index', index);
                const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
                title.textContent = 'Перемычка: тяните ЛКМ, ПКМ — убрать';
                dot.appendChild(title);
                this.edgesGroup.appendChild(dot);
            });
        });
    }

    // ---------- перемычки ----------

    startPlacing(edgeId, e) {
        const edge = this.edges.find(ed => ed.id === edgeId);
        if (!edge) return;
        this.state.placing = { edgeId, point: null, index: 0 };
        this.container.classList.add('placing');
        if (!this.placingDot) {
            this.placingDot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
            this.placingDot.setAttribute('class', 'tree-reroute tree-reroute-ghost');
            this.svg.appendChild(this.placingDot);
        }
        this.updatePlacing(e);
    }

    // Кружок едет по линии: ближайшая к курсору точка связи и отрезок, куда встанет перемычка.
    updatePlacing(e) {
        const edge = this.edges.find(ed => ed.id === this.state.placing?.edgeId);
        const geometry = edge && this.edgeGeometry(edge);
        if (!geometry) return this.cancelPlacing();
        const cursor = this.toLayout(e);
        let best = null;

        if (!geometry.points.length) {
            // Кривая без перемычек: ищем по точкам самой кривой.
            const path = this.edgesGroup.querySelector(`.tree-edge[data-edge-id="${CSS.escape(edge.id)}"]`);
            const total = path?.getTotalLength?.() || 0;
            const step = Math.max(2, total / 200);
            for (let l = 0; l <= total; l += step) {
                const sp = path.getPointAtLength(l);
                const lp = { x: (sp.x - this.state.panX) / this.state.zoom, y: (sp.y - this.state.panY) / this.state.zoom };
                const dist = Math.hypot(lp.x - cursor.x, lp.y - cursor.y);
                if (!best || dist < best.dist) best = { dist, point: lp, index: 0 };
            }
        } else {
            const chain = [geometry.start, ...geometry.points, geometry.end];
            for (let i = 0; i < chain.length - 1; i++) {
                const a = chain[i], b = chain[i + 1];
                const len2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2 || 1;
                const t = Math.max(0, Math.min(1, ((cursor.x - a.x) * (b.x - a.x) + (cursor.y - a.y) * (b.y - a.y)) / len2));
                const point = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
                const dist = Math.hypot(point.x - cursor.x, point.y - cursor.y);
                if (!best || dist < best.dist) best = { dist, point, index: i };
            }
        }
        if (!best) return;
        this.state.placing.point = best.point;
        this.state.placing.index = best.index;
        const sp = this.toScreen(best.point);
        this.placingDot.setAttribute('cx', sp.x);
        this.placingDot.setAttribute('cy', sp.y);
        this.placingDot.setAttribute('r', Math.max(4, 6 * this.state.zoom));
    }

    commitPlacing() {
        const { edgeId, point, index } = this.state.placing || {};
        const edge = this.edges.find(ed => ed.id === edgeId);
        this.cancelPlacing();
        if (!edge || !point) return;
        const anchor = this.edgeAnchor(edge);
        const points = this.edgePoints[edge.key] || (this.edgePoints[edge.key] = []);
        points.splice(index, 0, { dx: Math.round(point.x - anchor.x), dy: Math.round(point.y - anchor.y) });
        this.renderEdges();
        this.savePoints(edge);
    }

    cancelPlacing() {
        this.state.placing = null;
        this.container.classList.remove('placing');
        this.placingDot?.remove();
        this.placingDot = null;
    }

    removePoint(edgeId, index) {
        const edge = this.edges.find(ed => ed.id === edgeId);
        const points = edge && this.edgePoints[edge.key];
        if (!points) return;
        points.splice(index, 1);
        if (!points.length) delete this.edgePoints[edge.key];
        this.renderEdges();
        this.savePoints(edge);
    }

    savePoints(edge) {
        this.callbacks.onEdgePointsChange?.(edge.key, this.edgePoints[edge.key] || []);
    }

    renderNodes() {
        this.nodesContainer.innerHTML = '';
        
        if (this.nodes.size === 0) {
            const emptyState = document.createElement('div');
            emptyState.className = 'tree-empty-state';
            emptyState.innerHTML = `
                <div class="tree-empty-state-icon">💬</div>
                <div>Нет реплик</div>
                <div style="font-size: 12px; margin-top: 8px;">Нажмите "+ Добавить реплику" для создания</div>
            `;
            this.nodesContainer.appendChild(emptyState);
            return;
        }
        
        this.nodes.forEach((nodeData, id) => {
            const nodeEl = this.createNodeElement(nodeData);
            this.nodesContainer.appendChild(nodeEl);
            // offsetHeight не зависит от масштаба дерева; 0 — дерево скрыто, берём стандартную высоту.
            nodeData.height = nodeEl.offsetHeight || nodeData.height || null;
        });
    }
    
    createNodeElement(nodeData) {
        const node = document.createElement('div');
        node.className = 'tree-node-visual';
        node.dataset.nodeId = nodeData.id;
        
        if (nodeData.hasChoice) {
            node.classList.add('has-choice');
        }
        
        const isFirstInBranch = this.isFirstInBranch(nodeData);
        if (isFirstInBranch && nodeData.branchId !== 'main') {
            node.classList.add('branch-start');
        }
        
        if (this.state.selectedNodeId === nodeData.id) {
            node.classList.add('selected');
        }
        
        if (this.state.connectingFrom === nodeData.id) {
            node.classList.add('connecting-mode');
        }
        
        node.style.left = `${nodeData.x}px`;
        node.style.top = `${nodeData.y}px`;
        node.style.width = `${this.options.nodeWidth}px`;
        
        const textPreview = nodeData.text.length > 60 
            ? nodeData.text.substring(0, 60) + '...' 
            : nodeData.text;
        
        const connectBtn = nodeData.hasChoice 
            ? '<button class="tree-node-action-btn connect disabled" title="Недоступно для реплик с выбором" disabled>↗</button>'
            : '<button class="tree-node-action-btn connect" title="Создать связь" data-action="connect">↗</button>';
        
        node.innerHTML = `
            <div class="tree-node-actions">
                ${connectBtn}
                <button class="tree-node-action-btn edit" title="Редактировать" data-action="edit">✎</button>
                <button class="tree-node-action-btn delete" title="Удалить" data-action="delete">×</button>
            </div>
            <div class="tree-node-header">
                <span class="tree-node-speaker">${this.escapeHtml(nodeData.speaker)}</span>
                ${nodeData.hasChoice ? '<span class="tree-node-badge choice-badge">Выбор</span>' : ''}
                ${nodeData.variantAudiences.length ? `<span class="tree-node-badge variant-badge" title="Своя реплика для: ${nodeData.variantAudiences.map(a => ({ cavalier: 'Кавалера в Доме', exile: 'изгнанника' }[a] || a)).join(', ')}">⇄ ${nodeData.variantAudiences.map(a => ({ cavalier: 'К', exile: 'И' }[a] || '')).join('')}</span>` : ''}
            </div>
            <div class="tree-node-text">${this.escapeHtml(textPreview)}</div>
        `;
        
        node.addEventListener('click', (e) => this.handleNodeClick(e, nodeData));
        node.addEventListener('dblclick', (e) => this.handleNodeDoubleClick(e, nodeData));
        
        node.querySelectorAll('.tree-node-action-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = btn.dataset.action;
                this.handleNodeAction(action, nodeData, e);
            });
        });
        
        return node;
    }
    
    isFirstInBranch(nodeData) {
        const branchConvs = this.data.conversations
            .filter(c => c.branch_id === nodeData.branchId)
            .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0));
        
        return branchConvs.length > 0 && branchConvs[0].id === nodeData.conversationId;
    }
    
    hasIncomingEdges(nodeData) {
        const isSequential = !this.isFirstInBranch(nodeData);
        if (isSequential) return true;
        
        const nodeBranchId = nodeData.branchId;
        const hasChoiceIncoming = this.data.choices.some(choice => {
            return choice.target_branch === nodeBranchId;
        });
        if (hasChoiceIncoming) return true;
        
        return this.edges.some(edge => edge.target === nodeData.id);
    }
    
    handleNodeClick(e, nodeData) {
        if (this.state.connectingFrom && this.state.connectingFrom !== nodeData.id) {
            const fromNode = this.nodes.get(this.state.connectingFrom);
            if (fromNode && fromNode.hasChoice) {
                this.cancelConnecting();
                return;
            }
            if (nodeData.hasChoice) {
                this.cancelConnecting();
                return;
            }
            this.createConnection(this.state.connectingFrom, nodeData.id);
            this.cancelConnecting();
            return;
        }
        
        this.selectNode(nodeData.id);
        
        if (this.callbacks.onNodeClick) {
            this.callbacks.onNodeClick(nodeData);
        }
    }
    
    handleNodeDoubleClick(e, nodeData) {
        if (this.callbacks.onNodeEdit) {
            this.callbacks.onNodeEdit(nodeData);
        }
    }
    
    handleNodeAction(action, nodeData, e) {
        debug('handleNodeAction:', action, nodeData);
        switch (action) {
            case 'edit':
                if (this.callbacks.onNodeEdit) {
                    this.callbacks.onNodeEdit(nodeData);
                }
                break;
            case 'delete':
                if (this.callbacks.onNodeDelete) {
                    this.callbacks.onNodeDelete(nodeData);
                }
                break;
            case 'connect':
                if (!nodeData.hasChoice) {
                    this.toggleConnecting(nodeData.id);
                }
                break;
        }
    }
    
    toggleConnecting(nodeId) {
        if (this.state.connectingFrom === nodeId) {
            this.cancelConnecting();
            return;
        }
        this.cancelCutting();
        this.state.connectingFrom = nodeId;
        this.state.pointer = null;
        this.container.classList.add('connecting');
        this.renderNodes();
        this.renderConnectPreview();
    }

    cancelConnecting() {
        if (!this.state.connectingFrom) return;
        this.state.connectingFrom = null;
        this.state.pointer = null;
        this.container.classList.remove('connecting');
        this.connectPreview?.remove();
        this.connectPreview = null;
        this.renderNodes();
    }

    // Временная связь от низа исходной реплики к курсору (координаты контейнера).
    renderConnectPreview() {
        const from = this.nodes.get(this.state.connectingFrom);
        if (!from) return;
        if (!this.connectPreview) {
            this.connectPreview = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            this.connectPreview.setAttribute('class', 'tree-edge tree-edge-preview');
            this.connectPreview.setAttribute('marker-end', 'url(#arrowhead)');
            this.svg.appendChild(this.connectPreview);
        }
        const { zoom, panX, panY } = this.state;
        const startX = (from.x + this.options.nodeWidth / 2) * zoom + panX;
        const startY = (from.y + this.options.nodeHeight) * zoom + panY;
        const end = this.state.pointer || { x: startX, y: startY + 40 * zoom };
        const midY = (startY + end.y) / 2;
        this.connectPreview.setAttribute('d', `M ${startX} ${startY} C ${startX} ${midY}, ${end.x} ${midY}, ${end.x} ${end.y}`);
        this.connectPreview.setAttribute('stroke-width', 2 * zoom);
    }

    // ---------- ножницы ----------

    startCutting() {
        this.cancelConnecting();
        this.state.cutting = true;
        this.container.classList.add('cutting');
    }

    cancelCutting() {
        if (!this.state.cutting) return;
        this.state.cutting = false;
        this.container.classList.remove('cutting');
        this.edgesGroup.querySelectorAll('.cut-hover').forEach(el => el.classList.remove('cut-hover'));
    }

    hoverEdge(hit, on) {
        if (!hit || this.state.placing) return;
        this.edgesGroup.querySelector(`.tree-edge[data-edge-id="${CSS.escape(hit.dataset.edgeId)}"]`)
            ?.classList.toggle(this.state.cutting ? 'cut-hover' : 'edge-hover', on);
    }

    cutEdge(edgeId) {
        const edge = this.edges.find(e => e.id === edgeId);
        this.cancelCutting();
        if (!edge || !this.callbacks.onEdgeCut) return;
        const source = this.nodes.get(edge.source);
        const target = this.nodes.get(edge.target);
        this.callbacks.onEdgeCut({
            type: edge.type,
            fromConversationId: source?.conversationId,
            toConversationId: target?.conversationId,
            choiceOptionId: edge.choiceOptionId || null
        });
    }

    createConnection(fromId, toId) {
        if (this.callbacks.onConnectionCreate) {
            const fromNode = this.nodes.get(fromId);
            const toNode = this.nodes.get(toId);
            this.callbacks.onConnectionCreate(fromNode, toNode);
        }
    }
    
    selectNode(nodeId) {
        this.state.selectedNodeId = nodeId;
        this.renderNodes();
    }
    
    deselectNode() {
        this.state.selectedNodeId = null;
        this.renderNodes();
    }
    
    handleMouseDown(e) {
        // Ставим перемычку: ЛКМ фиксирует кружок на связи.
        if (this.state.placing) {
            if (e.button === 0) { e.preventDefault(); this.commitPlacing(); }
            return;
        }
        // Перетаскивание перемычки.
        const handle = e.target.closest?.('.tree-reroute');
        if (handle && e.button === 0 && !this.state.cutting) {
            e.preventDefault();
            this.state.dragPoint = { edgeId: handle.dataset.edgeId, index: Number(handle.dataset.index) };
            this.container.classList.add('dragging-point');
            return;
        }
        // В режимах связи и ножниц левая кнопка не двигает узлы и не панорамирует.
        if ((this.state.connectingFrom || this.state.cutting) && e.button === 0) return;
        if (e.button === 1 || (e.button === 0 && e.target === this.container)) {
            this.state.isPanning = true;
            this.state.panStartX = e.clientX - this.state.panX;
            this.state.panStartY = e.clientY - this.state.panY;
            this.container.classList.add('grabbing');
            e.preventDefault();
            return;
        }
        
        const nodeEl = e.target.closest('.tree-node-visual');
        if (nodeEl && e.button === 0) {
            const nodeId = nodeEl.dataset.nodeId;
            const nodeData = this.nodes.get(nodeId);
            
            if (nodeData && !e.target.closest('.tree-node-action-btn')) {
                this.state.isDragging = true;
                this.state.dragNode = nodeId;
                
                const rect = nodeEl.getBoundingClientRect();
                this.state.dragOffsetX = e.clientX - rect.left;
                this.state.dragOffsetY = e.clientY - rect.top;
                
                nodeEl.classList.add('dragging');
                this.container.classList.add('dragging-node');
            }
        }
    }
    
    handleMouseMove(e) {
        if (this.state.placing) {
            this.updatePlacing(e);
            return;
        }
        if (this.state.dragPoint) {
            const { edgeId, index } = this.state.dragPoint;
            const edge = this.edges.find(ed => ed.id === edgeId);
            const points = edge && this.edgePoints[edge.key];
            if (points && points[index]) {
                const anchor = this.edgeAnchor(edge);
                const p = this.toLayout(e);
                points[index] = { dx: Math.round(p.x - anchor.x), dy: Math.round(p.y - anchor.y) };
                this.renderEdges();
            }
            return;
        }
        if (this.state.connectingFrom) {
            const rect = this.container.getBoundingClientRect();
            this.state.pointer = { x: e.clientX - rect.left, y: e.clientY - rect.top };
            this.renderConnectPreview();
        }
        if (this.state.isPanning) {
            this.state.panX = e.clientX - this.state.panStartX;
            this.state.panY = e.clientY - this.state.panStartY;
            this.updateTransform();
            return;
        }
        
        if (this.state.isDragging && this.state.dragNode) {
            const containerRect = this.container.getBoundingClientRect();
            const x = (e.clientX - containerRect.left - this.state.dragOffsetX - this.state.panX) / this.state.zoom;
            const y = (e.clientY - containerRect.top - this.state.dragOffsetY - this.state.panY) / this.state.zoom;
            
            const nodeData = this.nodes.get(this.state.dragNode);
            if (nodeData) {
                nodeData.x = Math.max(0, x);
                nodeData.y = Math.max(0, y);
                
                const nodeEl = document.querySelector(`[data-node-id="${this.state.dragNode}"]`);
                if (nodeEl) {
                    nodeEl.style.left = `${nodeData.x}px`;
                    nodeEl.style.top = `${nodeData.y}px`;
                }
                
                this.renderEdges();
            }
        }
    }
    
    handleMouseUp(e) {
        if (this.state.dragPoint) {
            const edge = this.edges.find(ed => ed.id === this.state.dragPoint.edgeId);
            this.state.dragPoint = null;
            this.container.classList.remove('dragging-point');
            if (edge) this.savePoints(edge);
            return;
        }
        if (this.state.isPanning) {
            this.state.isPanning = false;
            this.container.classList.remove('grabbing');
        }
        
        if (this.state.isDragging) {
            const nodeEl = document.querySelector(`[data-node-id="${this.state.dragNode}"]`);
            if (nodeEl) {
                nodeEl.classList.remove('dragging');
            }
            this.container.classList.remove('dragging-node');
            this.state.isDragging = false;
            this.state.dragNode = null;
        }
    }
    
    handleWheel(e) {
        e.preventDefault();
        
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        const newZoom = Math.max(0.25, Math.min(2, this.state.zoom + delta));
        
        const containerRect = this.container.getBoundingClientRect();
        const mouseX = e.clientX - containerRect.left;
        const mouseY = e.clientY - containerRect.top;
        
        const zoomRatio = newZoom / this.state.zoom;
        this.state.panX = mouseX - (mouseX - this.state.panX) * zoomRatio;
        this.state.panY = mouseY - (mouseY - this.state.panY) * zoomRatio;
        
        this.state.zoom = newZoom;
        this.updateTransform();
        this.updateZoomDisplay();
    }
    
    handleContextMenu(e) {
        e.preventDefault();
        // ПКМ при постановке перемычки — отмена.
        if (this.state.placing) {
            this.cancelPlacing();
            return;
        }
        // ПКМ по перемычке — убрать её.
        const handle = e.target.closest?.('.tree-reroute');
        if (handle) {
            this.removePoint(handle.dataset.edgeId, Number(handle.dataset.index));
            return;
        }
        // ПКМ где угодно в дереве отменяет протягивание связи и ножницы, меню не открывается.
        if (this.state.connectingFrom || this.state.cutting) {
            this.cancelConnecting();
            this.cancelCutting();
            return;
        }
        
        const nodeEl = e.target.closest('.tree-node-visual');
        if (nodeEl) {
            const nodeId = nodeEl.dataset.nodeId;
            const nodeData = this.nodes.get(nodeId);
            this.showContextMenu(e.clientX, e.clientY, nodeData);
        } else if (e.target === this.container || e.target.closest('.dialogue-tree-svg')) {
            this.showContextMenu(e.clientX, e.clientY, null, {
                x: (e.offsetX - this.state.panX) / this.state.zoom,
                y: (e.offsetY - this.state.panY) / this.state.zoom
            });
        }
    }
    
    showContextMenu(x, y, nodeData, position = null) {
        this.hideContextMenu();
        
        this.contextMenu = document.createElement('div');
        this.contextMenu.className = 'tree-context-menu';
        this.contextMenu.style.left = `${x}px`;
        this.contextMenu.style.top = `${y}px`;
        
        if (nodeData) {
            const hasIncoming = this.hasIncomingEdges(nodeData);
            
            let menuItems = `
                <div class="tree-context-menu-item" data-action="edit">✏️ Редактировать</div>
            `;
            
            if (!nodeData.hasChoice) {
                if (!hasIncoming) {
                    menuItems += `
                        <div class="tree-context-menu-item" data-action="add-before">⬆️ Добавить перед</div>
                    `;
                }
                menuItems += `
                    <div class="tree-context-menu-item" data-action="add-after">➕ Добавить после</div>
                    <div class="tree-context-menu-item" data-action="connect">🔗 Создать связь</div>
                `;
            } else {
                menuItems += `
                    <div class="tree-context-menu-item disabled" title="Недоступно для реплик с выбором">⬆️ Добавить перед</div>
                    <div class="tree-context-menu-item disabled" title="Недоступно для реплик с выбором">➕ Добавить после</div>
                    <div class="tree-context-menu-item disabled" title="Недоступно для реплик с выбором">🔗 Создать связь</div>
                `;
            }
            
            menuItems += `
                <div class="tree-context-menu-item" data-action="unlink">✂️ Удалить связь (ножницы)</div>
            `;
            
            menuItems += `
                <div class="tree-context-menu-divider"></div>
                <div class="tree-context-menu-item danger" data-action="delete">🗑️ Удалить</div>
            `;
            
            this.contextMenu.innerHTML = menuItems;
        } else {
            this.contextMenu.innerHTML = `
                <div class="tree-context-menu-item" data-action="add-here">➕ Добавить реплику здесь</div>
                <div class="tree-context-menu-item" data-action="unlink">✂️ Удалить связь (ножницы)</div>
                <div class="tree-context-menu-divider"></div>
                <div class="tree-context-menu-item" data-action="auto-layout">⟳ Авто-компоновка</div>
            `;
            
            if (position) {
                this.contextMenu.dataset.posX = position.x;
                this.contextMenu.dataset.posY = position.y;
            }
        }
        
        this.contextMenu.querySelectorAll('.tree-context-menu-item:not(.disabled)').forEach(item => {
            item.addEventListener('click', (e) => {
                const action = item.dataset.action;
                this.handleContextAction(action, nodeData);
                this.hideContextMenu();
            });
        });
        
        document.body.appendChild(this.contextMenu);

        // Не даём меню уйти за край окна: у нижней или правой границы оно открывается вверх / влево.
        const rect = this.contextMenu.getBoundingClientRect();
        const margin = 8;
        if (rect.bottom > window.innerHeight - margin) {
            this.contextMenu.style.top = `${Math.max(margin, y - rect.height)}px`;
        }
        if (rect.right > window.innerWidth - margin) {
            this.contextMenu.style.left = `${Math.max(margin, x - rect.width)}px`;
        }
    }
    
    hideContextMenu() {
        if (this.contextMenu) {
            this.contextMenu.remove();
            this.contextMenu = null;
        }
    }
    
    handleContextAction(action, nodeData) {
        switch (action) {
            case 'edit':
                if (this.callbacks.onNodeEdit && nodeData) {
                    this.callbacks.onNodeEdit(nodeData);
                }
                break;
            case 'add-after':
            case 'add-here':
                if (this.callbacks.onNodeAdd) {
                    const pos = this.contextMenu ? {
                        x: parseFloat(this.contextMenu.dataset.posX) || 0,
                        y: parseFloat(this.contextMenu.dataset.posY) || 0
                    } : null;
                    this.callbacks.onNodeAdd(nodeData, pos);
                }
                break;
            case 'add-before':
                if (this.callbacks.onNodeAddBefore) {
                    this.callbacks.onNodeAddBefore(nodeData);
                }
                break;
            case 'connect':
                if (nodeData) {
                    this.toggleConnecting(nodeData.id);
                }
                break;
            case 'unlink':
                this.startCutting();
                break;
            case 'delete':
                if (this.callbacks.onNodeDelete && nodeData) {
                    this.callbacks.onNodeDelete(nodeData);
                }
                break;
            case 'auto-layout':
                this.autoLayout();
                break;
        }
    }
    
    updateTransform() {
        const transform = `translate(${this.state.panX}px, ${this.state.panY}px) scale(${this.state.zoom})`;
        this.nodesContainer.style.transform = transform;
        this.renderEdges();
        if (this.state.connectingFrom) this.renderConnectPreview();
    }
    
    updateZoomDisplay() {
        const zoomDisplay = document.getElementById('zoom-level');
        if (zoomDisplay) {
            zoomDisplay.textContent = `${Math.round(this.state.zoom * 100)}%`;
        }
    }
    
    zoomIn() {
        this.state.zoom = Math.min(2, this.state.zoom + 0.1);
        this.updateTransform();
        this.updateZoomDisplay();
    }
    
    zoomOut() {
        this.state.zoom = Math.max(0.25, this.state.zoom - 0.1);
        this.updateTransform();
        this.updateZoomDisplay();
    }
    
    zoomToFit() {
        if (this.nodes.size === 0) {
            this.state.zoom = 1;
            this.state.panX = 0;
            this.state.panY = 0;
            this.updateTransform();
            this.updateZoomDisplay();
            return;
        }
        
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;
        
        this.nodes.forEach(node => {
            minX = Math.min(minX, node.x);
            minY = Math.min(minY, node.y);
            maxX = Math.max(maxX, node.x + this.options.nodeWidth);
            maxY = Math.max(maxY, node.y + this.options.nodeHeight);
        });
        
        const contentWidth = maxX - minX + 100;
        const contentHeight = maxY - minY + 100;
        
        const containerRect = this.container.getBoundingClientRect();
        const scaleX = containerRect.width / contentWidth;
        const scaleY = containerRect.height / contentHeight;
        
        this.state.zoom = Math.min(1, Math.min(scaleX, scaleY));
        this.state.panX = (containerRect.width - contentWidth * this.state.zoom) / 2 - minX * this.state.zoom + 50;
        this.state.panY = (containerRect.height - contentHeight * this.state.zoom) / 2 - minY * this.state.zoom + 50;
        
        this.updateTransform();
        this.updateZoomDisplay();
    }
    
    on(event, callback) {
        if (this.callbacks.hasOwnProperty(`on${event.charAt(0).toUpperCase() + event.slice(1)}`)) {
            this.callbacks[`on${event.charAt(0).toUpperCase() + event.slice(1)}`] = callback;
        }
    }
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    highlightNode(nodeId) {
        const nodeEl = document.querySelector(`[data-node-id="${nodeId}"]`);
        if (nodeEl) {
            nodeEl.classList.add('highlighted');
            setTimeout(() => nodeEl.classList.remove('highlighted'), 2000);
        }
    }
    
    focusOnNode(nodeId) {
        const nodeData = this.nodes.get(nodeId);
        if (!nodeData) return;
        
        const containerRect = this.container.getBoundingClientRect();
        const targetX = containerRect.width / 2 - (nodeData.x + this.options.nodeWidth / 2) * this.state.zoom;
        const targetY = containerRect.height / 2 - (nodeData.y + this.options.nodeHeight / 2) * this.state.zoom;
        
        this.state.panX = targetX;
        this.state.panY = targetY;
        this.updateTransform();
        
        this.selectNode(nodeId);
    }
    
    destroy() {
        this.hideContextMenu();
        this.nodesContainer.innerHTML = '';
        this.edgesGroup.innerHTML = '';
        this.nodes.clear();
        this.edges = [];
    }
}

export default DialogueTreeVisualizer;
