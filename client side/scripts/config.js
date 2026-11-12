const SERVER_ORIGIN = `${window.location.protocol}//${window.location.hostname}:3000`;

const AppConfig = {
	Debug: false,
    API_URL: `${SERVER_ORIGIN}/api`,
    ASSETS_URL: `${SERVER_ORIGIN}/assets`,
    ITEMS_PER_PAGE: 10,
    CACHE_HEADERS: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
    }
};

export default AppConfig;
