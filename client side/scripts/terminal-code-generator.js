class TerminalCodeGenerator {
    constructor() {
        this.registers = ['EAX', 'EBX', 'ECX', 'EDX', 'ESI', 'EDI', 'ESP', 'EBP'];
        this.operations = [
            'MOV', 'PUSH', 'POP', 'ADD', 'SUB', 'XOR',
            'AND', 'OR', 'TEST', 'CMP', 'CALL', 'RET'
        ];
        this.memoryTypes = [
            '[EAX]', '[EBX+8]', '[ECX]',
            'DWORD PTR [EDX]', 'WORD PTR [ESI]'
        ];
        this.hexValues = [
            '0x00', '0x01', '0x10', '0x20',
            '0x40', '0x80', '0xFF', '0xA5'
        ];
    }

    generateRandomHex() {
        return this.hexValues[Math.floor(Math.random() * this.hexValues.length)];
    }

    generateRandomRegister() {
        return this.registers[Math.floor(Math.random() * this.registers.length)];
    }

    generateRandomOperation() {
        return this.operations[Math.floor(Math.random() * this.operations.length)];
    }

    generateRandomMemory() {
        return this.memoryTypes[Math.floor(Math.random() * this.memoryTypes.length)];
    }

    generateCodeLine() {
        const operation = this.generateRandomOperation();
        const reg1 = this.generateRandomRegister();
        const reg2 = this.generateRandomRegister();
        const memory = this.generateRandomMemory();
        const hex = this.generateRandomHex();
        const templates = [
            `${operation} ${reg1}, ${hex}`,
            `${operation} ${reg1}, ${memory}`,
            `${operation} ${reg1}, ${reg2}`,
            `${operation} ${memory}, ${hex}`
        ];
        return templates[Math.floor(Math.random() * templates.length)];
    }
}

