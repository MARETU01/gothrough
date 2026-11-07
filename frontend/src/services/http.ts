import axios from 'axios';

const defaults = {
    baseURL: '/api',
    timeout: 30000,
};

// Conditional reads need status and headers as well as the response body.
export const responseApi = axios.create(defaults);
const api = axios.create(defaults);

for (const client of [api, responseApi]) {
    client.interceptors.response.use(undefined, error => {
        if (error.response?.status === 401 && error.response?.data?.code === 'AUTH_REQUIRED') {
            window.dispatchEvent(new Event('gothrough:auth-required'));
        }
        return Promise.reject(error);
    });
}

// 响应拦截器：统一取出 data
api.interceptors.response.use(
    res => res.data,
    err => {
        if (!axios.isCancel(err)) console.error('请求失败:', err.message);
        return Promise.reject(err);
    }
);

export default api;
