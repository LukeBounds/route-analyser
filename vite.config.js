import { defineConfig } from 'vite';

const [repositoryOwner = '', repositoryName = ''] = (process.env.GITHUB_REPOSITORY ?? '').split('/');
const isRootPagesRepository = repositoryName.toLowerCase() === `${repositoryOwner.toLowerCase()}.github.io`;
const pagesBase = process.env.GITHUB_ACTIONS === 'true' && repositoryName && !isRootPagesRepository
  ? `/${repositoryName}/`
  : '/';

export default defineConfig({
  base: pagesBase,
  build: {
    outDir: 'build',
  },
});
