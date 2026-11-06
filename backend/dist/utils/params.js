"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseParamInt = parseParamInt;
exports.bodyStr = bodyStr;
/**
 * Safely parse a route parameter as integer.
 * Express params can be string | string[], this helper handles both.
 */
function parseParamInt(param) {
    if (Array.isArray(param))
        return parseInt(param[0] || '0', 10);
    return parseInt(param || '0', 10);
}
/**
 * Get a body field as string safely.
 */
function bodyStr(value) {
    if (typeof value === 'string')
        return value;
    return '';
}
//# sourceMappingURL=params.js.map