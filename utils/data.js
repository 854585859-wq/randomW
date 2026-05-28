import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data');

const FILES = {
  concerts: path.join(DATA_DIR, 'concerts.json'),
  venues: path.join(DATA_DIR, 'venues.json'),
  venueBookings: path.join(DATA_DIR, 'venueBookings.json'),
  users: path.join(DATA_DIR, 'users.json'),
};

export async function initDataFiles() {
  try { await fs.mkdir(DATA_DIR, { recursive: true }); } catch {}
  for (const [name, filePath] of Object.entries(FILES)) {
    try {
      await fs.access(filePath);
    } catch {
      if (name === 'users') {
        const bcrypt = (await import('bcrypt')).default;
        const hash = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'admin123', 10);
        await fs.writeFile(filePath, JSON.stringify([{
          id: 1,
          username: process.env.ADMIN_USERNAME || 'admin',
          password: hash,
        }], null, 2));
      } else {
        await fs.writeFile(filePath, '[]');
      }
    }
  }
}

export async function readData(name) {
  const raw = await fs.readFile(FILES[name], 'utf-8');
  return JSON.parse(raw);
}

export async function writeData(name, data) {
  await fs.writeFile(FILES[name], JSON.stringify(data, null, 2));
}

export { FILES };
