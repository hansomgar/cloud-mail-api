import http from '@/axios/index.js';

export function apiKeyStatus() {
	return http.get('/api-keys');
}

export function apiKeyCreate(name) {
	return http.post('/api-keys', { name });
}

export function apiKeyRevoke(apiKeyId) {
	return http.delete(`/api-keys/${apiKeyId}`);
}