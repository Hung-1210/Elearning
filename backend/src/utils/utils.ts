import path from 'path';

export default class Utils {
  static generateRandomPassword(length = 8): string {
    const lowercase = 'abcdefghijklmnopqrstuvwxyz';
    const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const numbers = '0123456789';
    const special = '!@#$%^&';
    const all = lowercase + uppercase + numbers + special;

    let password =
      lowercase[Math.floor(Math.random() * lowercase.length)] +
      uppercase[Math.floor(Math.random() * uppercase.length)] +
      numbers[Math.floor(Math.random() * numbers.length)] +
      special[Math.floor(Math.random() * special.length)];

    for (let i = 4; i < length; i++) {
      password += all[Math.floor(Math.random() * all.length)];
    }

    return password.split('').sort(() => Math.random() - 0.5).join('');
  }

  static formatFileName(name: string): string {
    return name.replace(/"/g, "'").replace(/[\\/:*?"<>|]/g, '-');
  }

  static getUploadsDir(): string {
    return path.join(process.cwd(), 'uploads');
  }
}
