"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const path_1 = __importDefault(require("path"));
class Utils {
    static generateRandomPassword(length = 8) {
        const lowercase = 'abcdefghijklmnopqrstuvwxyz';
        const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        const numbers = '0123456789';
        const special = '!@#$%^&';
        const all = lowercase + uppercase + numbers + special;
        let password = lowercase[Math.floor(Math.random() * lowercase.length)] +
            uppercase[Math.floor(Math.random() * uppercase.length)] +
            numbers[Math.floor(Math.random() * numbers.length)] +
            special[Math.floor(Math.random() * special.length)];
        for (let i = 4; i < length; i++) {
            password += all[Math.floor(Math.random() * all.length)];
        }
        return password.split('').sort(() => Math.random() - 0.5).join('');
    }
    static formatFileName(name) {
        return name.replace(/"/g, "'").replace(/[\\/:*?"<>|]/g, '-');
    }
    static getUploadsDir() {
        return path_1.default.join(process.cwd(), 'uploads');
    }
}
exports.default = Utils;
//# sourceMappingURL=utils.js.map