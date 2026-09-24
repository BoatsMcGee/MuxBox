import {describe, it, expect} from 'vitest';
import path from 'node:path';
import {resolveTool} from '@app/mkvtoolnix';

describe('resolveTool', () => {
    // Expectations are built with the same path.join the resolver uses, so
    // host separators (\\ on Windows CI) compare correctly.
    const bundled = (platform: string, arch: string, tool: string): string =>
        path.join('R:', 'tools', `${platform}-${arch}`, 'bin', platform === 'win32' ? `${tool}.exe` : tool);
    const dev = (platform: string, arch: string, tool: string): string =>
        path.join('P:', 'buildResources', 'bin', `${platform}-${arch}`, 'bin', platform === 'win32' ? `${tool}.exe` : tool);

    it('prefers the bundled copy inside the packaged app', () => {
        const result = resolveTool('mkvmerge', {
            resourcesPath: 'R:',
            cwd: 'P:',
            platform: 'win32',
            arch: 'x64',
            exists: (candidate) => candidate === bundled('win32', 'x64', 'mkvmerge'),
        });

        expect(result).toBe(bundled('win32', 'x64', 'mkvmerge'));
    });

    it('falls back to the development copy fetched by fetch:tools', () => {
        const seen: string[] = [];
        const result = resolveTool('opusenc', {
            resourcesPath: 'R:',
            cwd: 'P:',
            platform: 'linux',
            arch: 'arm64',
            exists: (candidate) => {
                seen.push(candidate);
                return candidate === dev('linux', 'arm64', 'opusenc');
            },
        });

        expect(result).toBe(dev('linux', 'arm64', 'opusenc'));
        expect(seen).toEqual([
            bundled('linux', 'arm64', 'opusenc'),
            dev('linux', 'arm64', 'opusenc'),
        ]);
    });

    it('returns the bare name for a PATH lookup when nothing is bundled', () => {
        const result = resolveTool('mkvinfo', {
            resourcesPath: 'R:',
            cwd: 'P:',
            platform: 'darwin',
            arch: 'x64',
            exists: () => false,
        });

        expect(result).toBe('mkvinfo');
    });

    it('appends .exe only on win32', () => {
        const seen: string[] = [];
        resolveTool('mkvmerge', {
            resourcesPath: 'R:',
            cwd: 'P:',
            platform: 'darwin',
            arch: 'arm64',
            exists: (candidate) => {
                seen.push(candidate);
                return false;
            },
        });

        expect(seen.every((candidate) => !candidate.endsWith('.exe'))).toBe(true);
    });

    it('skips the packaged lookup when resourcesPath is unavailable', () => {
        const seen: string[] = [];
        resolveTool('mkvmerge', {
            resourcesPath: undefined,
            cwd: 'P:',
            platform: 'win32',
            arch: 'arm64',
            exists: (candidate) => {
                seen.push(candidate);
                return false;
            },
        });

        expect(seen).toHaveLength(1);
        expect(seen[0]).toBe(dev('win32', 'arm64', 'mkvmerge'));
    });
});
