import { join } from 'path';

/** Where uploaded logos and item images are stored (served at /uploads/). */
export const uploadsDir = process.env.UPLOADS_DIR ? process.env.UPLOADS_DIR : join(process.cwd(), 'uploads');
