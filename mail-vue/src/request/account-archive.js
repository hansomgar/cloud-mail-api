import http from '@/axios/index.js'

export function accountArchiveList(params) {
	return http.get('/account/archive/list', {params})
}

export function accountArchiveDelete(items) {
	return http.delete('/account/archive/delete', {data: {items}})
}

export function adminAccountArchiveList(params) {
	return http.get('/admin/account-archives/list', {params})
}

export function adminAccountArchiveDelete(items) {
	return http.delete('/admin/account-archives/delete', {data: {items}})
}