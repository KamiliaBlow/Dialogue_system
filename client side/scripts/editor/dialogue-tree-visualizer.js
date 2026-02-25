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
            onNodeAdd: null
        };
        
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
                    this.edges.push({
                        id: `edge_${fromId}_${toId}`,
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
                                label: choice.option_text
                            });
                        }
                    }
                }
            }
        });
    }
    
    autoLayout() {
        if (this.nodes.size === 0) return;
        
        const g = new dagre.graphlib.Graph();
        g.setGraph({
            rankdir: 'TB',
            ranksep: this.options.rankSeparation,
            nodesep: this.options.nodeSeparation,
            marginx: 50,
            marginy: 50
        });
        g.setDefaultEdgeLabel(() => ({}));
        
        this.nodes.forEach((node, id) => {
            g.setNode(id, {
                width: this.options.nodeWidth,
                height: this.options.nodeHeight
            });
        });
        
        this.edges.forEach(edge => {
            g.setEdge(edge.source, edge.target);
        });
        
        dagre.layout(g);
        
        g.nodes().forEach(nodeId => {
            const node = g.node(nodeId);
            const nodeData = this.nodes.get(nodeId);
            if (nodeData && node) {
                nodeData.x = node.x - this.options.nodeWidth / 2;
                nodeData.y = node.y - this.options.nodeHeight / 2;
            }
        });
        
        this.render();
        this.zoomToFit();
    }
    
    render() {
        this.renderEdges();
        this.renderNodes();
        this.updateTransform();
    }
    
    renderEdges() {
        this.edgesGroup.innerHTML = '';
        
        this.edges.forEach(edge => {
            const sourceNode = this.nodes.get(edge.source);
            const targetNode = this.nodes.get(edge.target);
            
            if (!sourceNode || !targetNode) return;
            
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            
            const startX = sourceNode.x + this.options.nodeWidth / 2;
            const startY = sourceNode.y + this.options.nodeHeight;
            const endX = targetNode.x + this.options.nodeWidth / 2;
            const endY = targetNode.y;
            
            const midY = (startY + endY) / 2;
            const d = `M ${startX} ${startY} C ${startX} ${midY}, ${endX} ${midY}, ${endX} ${endY}`;
            
            path.setAttribute('d', d);
            path.setAttribute('class', `tree-edge ${edge.type === 'choice' ? 'choice-edge' : ''}`);
            path.setAttribute('data-edge-id', edge.id);
            path.setAttribute('marker-end', edge.type === 'choice' ? 'url(#arrowhead-choice)' : 'url(#arrowhead)');
            
            this.edgesGroup.appendChild(path);
            
            if (edge.label) {
                const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                text.setAttribute('x', (startX + endX) / 2);
                text.setAttribute('y', midY - 5);
                text.setAttribute('class', 'tree-edge-label');
                text.setAttribute('text-anchor', 'middle');
                const label = edge.label.length > 20 ? edge.label.substring(0, 20) + '...' : edge.label;
                text.textContent = label;
                this.edgesGroup.appendChild(text);
            }
        });
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
        
        node.innerHTML = `
            <div class="tree-node-actions">
                <button class="tree-node-action-btn connect" title="Создать связь" data-action="connect">↗</button>
                <button class="tree-node-action-btn edit" title="Редактировать" data-action="edit">✎</button>
                <button class="tree-node-action-btn delete" title="Удалить" data-action="delete">×</button>
            </div>
            <div class="tree-node-header">
                <span class="tree-node-speaker">${this.escapeHtml(nodeData.speaker)}</span>
                ${nodeData.hasChoice ? '<span class="tree-node-badge choice-badge">Выбор</span>' : ''}
                ${isFirstInBranch && nodeData.branchId !== 'main' ? `<span class="tree-node-badge">${nodeData.branchId}</span>` : ''}
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
    
    handleNodeClick(e, nodeData) {
        if (this.state.connectingFrom && this.state.connectingFrom !== nodeData.id) {
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
                this.toggleConnecting(nodeData.id);
                break;
        }
    }
    
    toggleConnecting(nodeId) {
        if (this.state.connectingFrom === nodeId) {
            this.cancelConnecting();
        } else {
            this.state.connectingFrom = nodeId;
            this.renderNodes();
        }
    }
    
    cancelConnecting() {
        this.state.connectingFrom = null;
        this.renderNodes();
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
            this.contextMenu.innerHTML = `
                <div class="tree-context-menu-item" data-action="edit">✏️ Редактировать</div>
                <div class="tree-context-menu-item" data-action="add-after">➕ Добавить после</div>
                <div class="tree-context-menu-item" data-action="connect">🔗 Создать связь</div>
                <div class="tree-context-menu-divider"></div>
                <div class="tree-context-menu-item danger" data-action="delete">🗑️ Удалить</div>
            `;
        } else {
            this.contextMenu.innerHTML = `
                <div class="tree-context-menu-item" data-action="add-here">➕ Добавить реплику здесь</div>
                <div class="tree-context-menu-divider"></div>
                <div class="tree-context-menu-item" data-action="auto-layout">⟳ Авто-компоновка</div>
            `;
            
            if (position) {
                this.contextMenu.dataset.posX = position.x;
                this.contextMenu.dataset.posY = position.y;
            }
        }
        
        this.contextMenu.querySelectorAll('.tree-context-menu-item').forEach(item => {
            item.addEventListener('click', (e) => {
                const action = item.dataset.action;
                this.handleContextAction(action, nodeData);
                this.hideContextMenu();
            });
        });
        
        document.body.appendChild(this.contextMenu);
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
            case 'connect':
                if (nodeData) {
                    this.toggleConnecting(nodeData.id);
                }
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
        this.edgesGroup.setAttribute('transform', `translate(${this.state.panX}, ${this.state.panY}) scale(${this.state.zoom})`);
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
