const AdminUtils = {
    showLoading(tabId) {
        const loading = document.getElementById(`${tabId}-loading`);
        const content = document.getElementById(`${tabId}-content`);
        
        if (loading) loading.style.display = 'flex';
        if (content) content.style.display = 'none';
    },
    
    hideLoading(tabId) {
        const loading = document.getElementById(`${tabId}-loading`);
        const content = document.getElementById(`${tabId}-content`);
        
        if (loading) loading.style.display = 'none';
        if (content) content.style.display = 'block';
    },
    
    showError(elementId, message) {
        const element = document.getElementById(elementId);
        if (!element) return;
        
        const errorDiv = document.createElement('div');
        errorDiv.className = 'alert alert-danger';
        errorDiv.textContent = message;
        
        element.innerHTML = '';
        element.appendChild(errorDiv);
        element.style.display = 'block';
        
        setTimeout(() => errorDiv.style.display = 'none', 5000);
    },
    
    showSuccess(elementId, message) {
        const element = document.getElementById(elementId);
        if (!element) return;
        
        const successDiv = document.createElement('div');
        successDiv.className = 'alert alert-success';
        successDiv.textContent = message;
        
        element.parentNode.insertBefore(successDiv, element);
        
        setTimeout(() => successDiv.remove(), 5000);
    },
    
    formatDate(dateString) {
        const date = new Date(dateString);
        return `${date.toLocaleDateString()} ${date.toLocaleTimeString()}`;
    },
    
    calculatePercent(value, total) {
        if (total === 0) return 0;
        return Math.round((value / total) * 100);
    },
    
    parseProgress(progress) {
        if (typeof progress === 'number') return progress;
        
        if (typeof progress === 'string') {
            const match = progress.match(/(\d+)/);
            if (match) return parseInt(match[1]);
        }
        
        return 0;
    },
    
    generateBackgroundCode() {
        const bgElement = document.getElementById('bgCode');
        if (!bgElement) return;
        
        const codeStrings = [
            "function initGMS4521() { return { status: 'ACTIVE', secLevel: 'ALPHA-7' }; }",
            "const terminalAccess = new SecurityProtocol('ADMIN', 0x7F);",
            "if (securityBreached) { initCountermeasures(PROTOCOL.OMEGA); }",
            "class DataStream extends BinaryProtocol { constructor() { super(0x8F); } }",
            "await terminal.connect('/dev/tty0', { encrypted: true });",
            "for (let i = 0; i < dataNodes.length; i++) { validate(dataNodes[i]); }",
            "const encryptionLevel = LEVEL.MAXIMUM;",
            "function parseIncomingSignals(data) { return new Transmission(data); }",
            "encryption.applyKey(generateRandomBytes(32));",
            "while (terminal.active) { terminal.processCommands(); }",
            "const vulnerabilities = system.scanForThreats();",
            "if (userAccess.level < 7) { throw new SecurityException(); }",
            "terminal.display('АКТИВИРОВАН ПРОТОКОЛ БЕЗОПАСНОСТИ GMS-4521');",
            "for (const node of network.activeNodes) { ping(node.address); }",
            "const userAccessLevel = authentication.validateCredentials(user);"
        ];
        
        for (let i = 0; i < 50; i++) {
            const line = document.createElement('div');
            line.className = 'code-line';
            line.textContent = codeStrings[Math.floor(Math.random() * codeStrings.length)];
            line.style.left = `${Math.random() * 100}%`;
            line.style.animationDuration = `${10 + Math.random() * 20}s`;
            line.style.animationDelay = `${Math.random() * 10}s`;
            bgElement.appendChild(line);
        }
    },
    
    async loadFrequenciesFromConfig() {
        try {
            const response = await fetch('Config.js');
            if (!response.ok) return ['145.55', 'PRIV', '???'];
            
            const content = await response.text();
            const match = content.match(/'frequencies':\s*\[(.*?)\]/s);
            
            if (!match || !match[1]) return ['145.55', 'PRIV', '???'];
            
            return match[1].split(',')
                .map(item => item.trim().replace(/['"]/g, ''))
                .filter(item => item);
        } catch {
            return ['145.55', 'PRIV', '???'];
        }
    }
};

export default AdminUtils;
