import http from '@/axios/index.js';

export function apiKeyStatus() {
	return http.get('/api-keys');
}

export function apiKeyCreate(params) {
	return http.post('/api-keys', typeof params === 'string' ? {name: params} : params);
}

export function apiKeyUpdate(apiKeyId, params) {
	return http.patch(`/api-keys/${apiKeyId}`, params);
}

export function apiKeyRevoke(apiKeyId) {
	return http.delete(`/api-keys/${apiKeyId}`);
}

export function adminApiKeyList(params) {
	return http.get('/admin/api-keys', {params});
}

export function adminApiKeyCreate(params) {
	return http.post('/admin/api-keys', params);
}

export function adminApiKeyUpdate(apiKeyId, params) {
	return http.patch(`/admin/api-keys/${apiKeyId}`, params);
}

export function adminApiKeyRevoke(apiKeyId) {
	return http.delete(`/admin/api-keys/${apiKeyId}`);
}