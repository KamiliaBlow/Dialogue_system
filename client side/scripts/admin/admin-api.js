import AppConfig from '../config.js';

const { API_URL, CACHE_HEADERS } = AppConfig;

class AdminAPI {
    static async checkAuth() {
        const response = await fetch(`${API_URL}/admin/check`, {
            credentials: 'include',
            headers: CACHE_HEADERS
        });
        
        if (!response.ok) {
            throw new Error(`Auth check failed: ${response.status}`);
        }
        
        return response.json();
    }
    
    static async getUsers() {
        return this.safeFetch(`${API_URL}/admin/users`);
    }
    
    static async changePassword(userId, newPassword) {
        return this.safeFetch(`${API_URL}/admin/change-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, newPassword })
        });
    }
    
    static async deleteUser(userId) {
        return this.safeFetch(`${API_URL}/admin/delete-user/${userId}`, {
            method: 'DELETE'
        });
    }
    
    static async getFrequencies() {
        return this.safeFetch(`${API_URL}/admin/frequencies`);
    }
    
    static async clearProgress(userId, frequency) {
        return this.safeFetch(`${API_URL}/admin/clear-progress`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, frequency })
        });
    }
    
    static async getChoiceStatistics() {
        return this.safeFetch(`${API_URL}/admin/choice-statistics`);
    }
    
    static async getDialoguesCount() {
        return this.safeFetch(`${API_URL}/admin/dialogues-count`);
    }
    
    static async getChoiceDetails(frequency, choiceId) {
        return this.safeFetch(`${API_URL}/admin/choice-details/${frequency}/${choiceId}`);
    }
    
    static async getUserProgress() {
        return this.safeFetch(`${API_URL}/admin/user-progress`);
    }
    
    static async logout() {
        return this.safeFetch(`${API_URL}/auth/logout`, { method: 'POST' });
    }
    
    static async safeFetch(url, options = {}) {
        const defaultOptions = {
            credentials: 'include',
            headers: {
                ...CACHE_HEADERS,
                ...(options.headers || {})
            }
        };
        
        const mergedOptions = { ...defaultOptions, ...options };
        
        try {
            const response = await fetch(url, mergedOptions);
            
            if (!response.ok) {
                const errorText = await response.text().catch(() => 'Unknown error');
                throw new Error(`Server error: ${response.status} - ${errorText}`);
            }
            
            return response.json();
        } catch (error) {
            console.error(`API Error [${url}]:`, error);
            throw error;
        }
    }
}

export default AdminAPI;
