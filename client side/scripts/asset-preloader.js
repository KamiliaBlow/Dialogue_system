class AssetPreloader {
    constructor() {
        this.cache = {
            images: new Map(),
            audio: new Map()
        };
        this.loading = {
            images: new Map(),
            audio: new Map()
        };
    }

    async preloadImage(url) {
        if (!url) return null;
        
        const fullUrl = typeof getAssetUrl === 'function' ? getAssetUrl(url) : url;
        
        if (this.cache.images.has(fullUrl)) {
            return this.cache.images.get(fullUrl);
        }
        
        if (this.loading.images.has(fullUrl)) {
            return this.loading.images.get(fullUrl);
        }
        
        const loadPromise = new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                this.cache.images.set(fullUrl, img);
                this.loading.images.delete(fullUrl);
                resolve(img);
            };
            img.onerror = (err) => {
                console.warn(`Failed to preload image: ${fullUrl}`, err);
                this.loading.images.delete(fullUrl);
                resolve(null);
            };
            img.src = fullUrl;
        });
        
        this.loading.images.set(fullUrl, loadPromise);
        return loadPromise;
    }

    async preloadAudio(url) {
        if (!url) return null;
        
        const fullUrl = typeof getAssetUrl === 'function' ? getAssetUrl(url) : url;
        
        if (this.cache.audio.has(fullUrl)) {
            return this.cache.audio.get(fullUrl);
        }
        
        if (this.loading.audio.has(fullUrl)) {
            return this.loading.audio.get(fullUrl);
        }
        
        const loadPromise = new Promise((resolve, reject) => {
            const audio = new Audio();
            
            const cleanup = () => {
                audio.oncanplaythrough = null;
                audio.onerror = null;
            };
            
            audio.oncanplaythrough = () => {
                cleanup();
                this.cache.audio.set(fullUrl, audio);
                this.loading.audio.delete(fullUrl);
                resolve(audio);
            };
            
            audio.onerror = (err) => {
                cleanup();
                console.warn(`Failed to preload audio: ${fullUrl}`, err);
                this.loading.audio.delete(fullUrl);
                resolve(null);
            };
            
            audio.src = fullUrl;
            audio.load();
        });
        
        this.loading.audio.set(fullUrl, loadPromise);
        return loadPromise;
    }

    getCachedImage(url) {
        if (!url) return null;
        const fullUrl = typeof getAssetUrl === 'function' ? getAssetUrl(url) : url;
        return this.cache.images.get(fullUrl) || null;
    }

    getCachedAudio(url) {
        if (!url) return null;
        const fullUrl = typeof getAssetUrl === 'function' ? getAssetUrl(url) : url;
        return this.cache.audio.get(fullUrl) || null;
    }

    async preloadDialogueAssets(dialogue) {
        if (!dialogue) return;
        
        const promises = [];
        
        if (dialogue.characters) {
            dialogue.characters.forEach(char => {
                if (char.image) {
                    promises.push(this.preloadImage(char.image));
                }
                if (char.voice) {
                    promises.push(this.preloadAudio(char.voice));
                }
            });
        }
        
        if (dialogue.conversations) {
            dialogue.conversations.forEach(conv => {
                if (conv.image) {
                    promises.push(this.preloadImage(conv.image));
                }
                if (conv.voiceline) {
                    promises.push(this.preloadAudio(conv.voiceline));
                }
            });
        }
        
        Object.keys(dialogue).forEach(key => {
            if (key !== 'conversations' && key !== 'characters' && key !== 'allowedUsers') {
                const branch = dialogue[key];
                if (Array.isArray(branch)) {
                    branch.forEach(conv => {
                        if (conv.image) {
                            promises.push(this.preloadImage(conv.image));
                        }
                        if (conv.voiceline) {
                            promises.push(this.preloadAudio(conv.voiceline));
                        }
                    });
                }
            }
        });
        
        await Promise.allSettled(promises);
    }

    clearCache() {
        this.cache.images.clear();
        this.cache.audio.clear();
    }

    getCacheStats() {
        return {
            images: this.cache.images.size,
            audio: this.cache.audio.size,
            loadingImages: this.loading.images.size,
            loadingAudio: this.loading.audio.size
        };
    }
}

const assetPreloader = new AssetPreloader();

export default assetPreloader;
export { AssetPreloader };
