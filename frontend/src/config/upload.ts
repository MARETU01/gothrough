/**
 * 上传相关可调参数。
 * 集中放置，便于调优时统一修改，避免散落在组件内。
 */

/** 单个分块大小（5MB），须与服务端配置一致；服务端未返回 chunk_size 时作为兜底值 */
export const CHUNK_SIZE = 5 * 1024 * 1024;

/** 单文件并发上传分块数 */
export const MAX_CONCURRENT_UPLOADS = 3;

/** 同时上传的最大文件数 */
export const MAX_CONCURRENT_FILES = 2;

/** axios 上传进度事件的重绘节流间隔（ms） */
export const PROGRESS_REFRESH_INTERVAL = 100;
