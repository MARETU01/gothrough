import axios from 'axios';

const api = axios.create({
    baseURL: '/api',
    timeout: 30000,
});

// 响应拦截器：统一取出 data
api.interceptors.response.use(
    res => res.data,
    err => {
        console.error('请求失败:', err.message);
        return Promise.reject(err);
    }
);

export default api;
