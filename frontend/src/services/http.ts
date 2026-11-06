import axios from 'axios';

const defaults = {
    baseURL: '/api',
    timeout: 30000,
};

// Conditional reads need status and headers as well as the response body.
export const responseApi = axios.create(defaults);
const api = axios.create(defaults);

// 响应拦截器：统一取出 data
api.interceptors.response.use(
    res => res.data,
    err => {
        console.error('请求失败:', err.message);
        return Promise.reject(err);
    }
);

export default api;
