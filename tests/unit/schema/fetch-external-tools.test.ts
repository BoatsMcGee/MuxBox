import {describe, it, expect} from 'vitest';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {isBrewRef, isRuntimeLibrary, isSystemRef, macosDmgName, macosDmgUrl, parseBrewRef, pickBottleTag, repositoryFromBottleUrl, tarExecutable} from '../../../scripts/fetch-external-tools.mjs';

describe('repositoryFromBottleUrl', () => {
    it('maps a versioned formula bottle url to its slash-separated repository', () => {
        expect(repositoryFromBottleUrl(
            'https://ghcr.io/v2/homebrew/core/icu4c/78/blobs/sha256:237dc113cc2df7c3b0c327ae96d567c71a86bc6d89c402860603e7b233933c05',
        )).toBe('homebrew/core/icu4c/78');
    });

    it('keeps plain formula repositories unchanged', () => {
        expect(repositoryFromBottleUrl(
            'https://ghcr.io/v2/homebrew/core/mkvtoolnix/blobs/sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
        )).toBe('homebrew/core/mkvtoolnix');
    });

    it('returns null for unrecognized urls so callers fall back to the formula name', () => {
        expect(repositoryFromBottleUrl('https://example.com/some/file.tar.gz')).toBeNull();
        expect(repositoryFromBottleUrl('not a url')).toBeNull();
    });
});

describe('tarExecutable', () => {
    it('resolves the executable for the current platform', () => {
        const tar = tarExecutable();
        if (process.platform === 'win32') {
            expect(path.basename(tar)).toBe('tar.exe');
            expect(existsSync(tar)).toBe(true);
        } else {
            expect(tar).toBe('tar');
        }
    });
});

describe('pickBottleTag', () => {
    const withFiles = (files: Record<string, unknown>) => ({
        name: 'demo',
        bottle: {stable: {files}},
    });

    it('prefers the platform-specific linux tag', () => {
        expect(pickBottleTag(withFiles({x86_64_linux: {}, arm64_linux: {}, all: {}}), 'linux', 'x64'))
            .toBe('x86_64_linux');
        expect(pickBottleTag(withFiles({x86_64_linux: {}, arm64_linux: {}}), 'linux', 'arm64'))
            .toBe('arm64_linux');
    });

    it('falls back to the arch-independent `all` bottle on linux (ca-certificates)', () => {
        expect(pickBottleTag(withFiles({all: {}}), 'linux', 'x64')).toBe('all');
    });

    it('fails on linux when only the other architecture is bottled', () => {
        expect(() => pickBottleTag(withFiles({arm64_linux: {}}), 'linux', 'x64'))
            .toThrow('has no x86_64_linux bottle');
    });

    it('uses the `all` bottle on arm64 macOS when no arm64 tag exists', () => {
        expect(pickBottleTag(withFiles({all: {}}), 'darwin', 'arm64')).toBe('all');
    });

    it('prefers the oldest available macOS codename over `all`', () => {
        expect(pickBottleTag(withFiles({all: {}, arm64_sonoma: {}, arm64_sequoia: {}}), 'darwin', 'arm64'))
            .toBe('arm64_sonoma');
    });

    it('picks the oldest Intel macOS tag', () => {
        expect(pickBottleTag(withFiles({sonoma: {}, ventura: {}}), 'darwin', 'x64')).toBe('ventura');
    });

    it('fails when the formula publishes no bottles at all', () => {
        expect(() => pickBottleTag({name: 'demo'}, 'linux', 'x64'))
            .toThrow('publishes no bottles');
    });
});

describe('macosDmgName', () => {
    it('maps arches to the upstream slice names', () => {
        expect(macosDmgName('x64')).toBe('MKVToolNix-102.0-2-x86_64.dmg');
        expect(macosDmgName('arm64')).toBe('MKVToolNix-102.0-2-arm64.dmg');
    });

    it('builds a release-relative url', () => {
        expect(macosDmgUrl('x64'))
            .toBe('https://mkvtoolnix.download/macos/releases/102.0/MKVToolNix-102.0-2-x86_64.dmg');
    });
});

describe('parseBrewRef', () => {
    it('maps Cellar references, dropping the version segment', () => {
        expect(parseBrewRef('/usr/local/Cellar/flac/1.5.0/lib/libFLAC.1.dylib'))
            .toEqual({formula: 'flac', relative: 'lib/libFLAC.1.dylib'});
    });

    it('maps opt references, keeping versioned formula names intact', () => {
        expect(parseBrewRef('/opt/homebrew/opt/openssl@3/lib/libssl.3.dylib'))
            .toEqual({formula: 'openssl@3', relative: 'lib/libssl.3.dylib'});
    });

    it('returns null for references outside a Homebrew prefix', () => {
        expect(parseBrewRef('/usr/lib/libSystem.B.dylib')).toBeNull();
        expect(parseBrewRef('/usr/local/lib/rogue.dylib')).toBeNull();
        expect(parseBrewRef('@executable_path/../lib/libQt6Core.6.dylib')).toBeNull();
    });

    // Relocatable bottles keep Homebrew's placeholders until `brew install` rewrites them.
    it('normalizes the @@HOMEBREW_PREFIX@@ placeholder (opt references)', () => {
        expect(parseBrewRef('@@HOMEBREW_PREFIX@@/opt/libopusenc/lib/libopusenc.0.dylib')).toEqual({
            formula: 'libopusenc',
            relative: 'lib/libopusenc.0.dylib',
        });
    });

    it('normalizes the @@HOMEBREW_CELLAR@@ placeholder (versioned references)', () => {
        expect(parseBrewRef('@@HOMEBREW_CELLAR@@/opus/1.6.1/lib/libopus.0.dylib')).toEqual({
            formula: 'opus',
            relative: 'lib/libopus.0.dylib',
        });
    });
});

describe('isSystemRef', () => {
    it('classifies dyld special and Apple system references as system', () => {
        expect(isSystemRef('@executable_path/libs/Qt6Core.framework/Qt6Core')).toBe(true);
        expect(isSystemRef('@loader_path/../lib/libfoo.dylib')).toBe(true);
        expect(isSystemRef('@rpath')).toBe(true);
        expect(isSystemRef('/usr/lib/libSystem.B.dylib')).toBe(true);
        expect(isSystemRef('/System/Library/Frameworks/CoreFoundation.framework/Versions/A/CoreFoundation')).toBe(true);
    });

    it('does NOT swallow placeholder or Homebrew references', () => {
        // Regression: startsWith('@') once classified @@HOMEBREW_PREFIX@@ refs as
        // system, which skipped both the link walk and the rewrite on macOS.
        expect(isSystemRef('@@HOMEBREW_PREFIX@@/opt/libopusenc/lib/libopusenc.0.dylib')).toBe(false);
        expect(isSystemRef('/opt/homebrew/opt/opus/lib/libopus.0.dylib')).toBe(false);
        expect(isSystemRef('/usr/local/Cellar/flac/1.5.0/lib/libFLAC.1.dylib')).toBe(false);
    });
});

describe('isBrewRef', () => {
    it('classifies resolved and placeholder Homebrew references as brew', () => {
        expect(isBrewRef('/opt/homebrew/opt/opus/lib/libopus.0.dylib')).toBe(true);
        expect(isBrewRef('/usr/local/Cellar/flac/1.5.0/lib/libFLAC.1.dylib')).toBe(true);
        expect(isBrewRef('@@HOMEBREW_PREFIX@@/opt/libopusenc/lib/libopusenc.0.dylib')).toBe(true);
    });

    it('rejects system and non-Homebrew references', () => {
        expect(isBrewRef('/usr/lib/libSystem.B.dylib')).toBe(false);
        expect(isBrewRef('@executable_path/libs/Qt6Core.framework/Qt6Core')).toBe(false);
        expect(isBrewRef('/opt/other/libfoo.dylib')).toBe(false);
    });
});

describe('isRuntimeLibrary', () => {
    it('accepts shared libraries with and without version suffixes', () => {
        expect(isRuntimeLibrary('/x/libFLAC.so')).toBe(true);
        expect(isRuntimeLibrary('/x/libFLAC.so.1.4.3')).toBe(true);
        expect(isRuntimeLibrary('/x/libFLAC++.dylib')).toBe(true);
        expect(isRuntimeLibrary('/x/libQt6Core.6.11.1.dylib')).toBe(true);
    });

    it('rejects static archives and dev files that break patchelf/otool', () => {
        expect(isRuntimeLibrary('/x/libFLAC++.a')).toBe(false);
        expect(isRuntimeLibrary('/x/Qt6Core.prl')).toBe(false);
        expect(isRuntimeLibrary('/x/libfoo.la')).toBe(false);
        expect(isRuntimeLibrary('/x/charset.alias')).toBe(false);
    });
});
