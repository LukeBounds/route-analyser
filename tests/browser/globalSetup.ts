import type { FullConfig } from '@playwright/test';
import { preview } from 'vite';

export default async function startPreviewServer(_config: FullConfig) {
    const server = await preview({
        configLoader: 'runner',
        logLevel: 'silent',
        preview: {
            host: '127.0.0.1',
            port: 4173,
            strictPort: true,
        },
    });

    return async () => {
        await new Promise<void>((resolve, reject) => {
            server.httpServer.close((problem?: Error) => problem ? reject(problem) : resolve());
        });
    };
}
