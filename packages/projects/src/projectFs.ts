import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ProjectData, ProjectListItem } from './types.js';

export function getProjectsDir(userDataPath: string): string {
    return path.join(userDataPath, 'projects');
}

export function getIndexPath(userDataPath: string): string {
    return path.join(getProjectsDir(userDataPath), 'index.json');
}

function ensureProjectsDir(userDataPath: string): void {
    const dir = getProjectsDir(userDataPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

function readIndex(userDataPath: string): ProjectListItem[] {
    ensureProjectsDir(userDataPath);
    const indexFile = getIndexPath(userDataPath);
    if (!fs.existsSync(indexFile)) {
        return [];
    }
    try {
        return JSON.parse(fs.readFileSync(indexFile, 'utf-8')) as ProjectListItem[];
    } catch {
        return [];
    }
}

function writeIndex(userDataPath: string, items: ProjectListItem[]): void {
    ensureProjectsDir(userDataPath);
    fs.writeFileSync(getIndexPath(userDataPath), JSON.stringify(items, null, 2));
}

export function listProjects(userDataPath: string): ProjectListItem[] {
    return readIndex(userDataPath);
}

/**
 * Migrate old-format `regex` values in source.match from embedded "/pattern/flags"
 * strings to the new `regex` (plain string) + `regexFlags` format.
 *
 * Old format:  { regex: "/\.mkv$/", episodeIndex: 1 }
 * New format:  { regex: "\.mkv$", regexFlags: "", episodeIndex: 1 }
 *
 * Also handles legacy RegExp objects (which serialize to "/pattern/flags" strings).
 * This ensures old project files work without a full migration step.
 */
function migrateSourceMatch(value: unknown): unknown {
    if (value === null || value === undefined) return value;
    if (Array.isArray(value)) {
        return value.map(migrateSourceMatch);
    }
    if (typeof value === 'object' && !(value instanceof RegExp)) {
        const obj = value as Record<string, unknown>;

        // Check if this looks like a source.match object with a legacy regex
        if ('regex' in obj && 'episodeIndex' in obj) {
            const regexVal = obj.regex;
            if (typeof regexVal === 'string' && regexVal.startsWith('/')) {
                // Legacy "/pattern/flags" format — extract pattern and flags
                const lastSlash = regexVal.lastIndexOf('/');
                const pattern = regexVal.slice(1, lastSlash);
                const flags = regexVal.slice(lastSlash + 1);
                obj.regex = pattern;
                if (flags && !obj.regexFlags) {
                    obj.regexFlags = flags;
                }
            }
        }

        const result: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(obj)) {
            result[k] = migrateSourceMatch(v);
        }
        return result;
    }
    return value;
}

export function loadProject(userDataPath: string, id: string): { data: ProjectData; travels: unknown } | null {
    const filePath = path.join(getProjectsDir(userDataPath), `${id}.json`);
    if (!fs.existsSync(filePath)) {
        return null;
    }
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8')) as { data: ProjectData; travels: unknown };
    // Migrate old-format regex strings in source.match to new separate regex + regexFlags format
    raw.data = migrateSourceMatch(raw.data) as ProjectData;
    return raw;
}

export function saveProject(userDataPath: string, payload: { data: ProjectData; travels: unknown }): void {
    ensureProjectsDir(userDataPath);
    const filePath = path.join(getProjectsDir(userDataPath), `${payload.data.id}.json`);
    const item: ProjectListItem = {
        id: payload.data.id,
        name: payload.data.name,
        seriesName: payload.data.seriesName,
        sourceCount: payload.data.sources.length,
        episodeCount: 0,
        lastOpened: Date.now(),
        createdAt: payload.data.createdAt,
    };
    fs.writeFileSync(filePath, JSON.stringify({ data: payload.data, travels: payload.travels }, null, 2));
    const items = readIndex(userDataPath);
    const existing = items.findIndex((i) => i.id === item.id);
    if (existing >= 0) {
        items[existing] = item;
    } else {
        items.push(item);
    }
    writeIndex(userDataPath, items);
}

export function removeProject(userDataPath: string, id: string): void {
    const filePath = path.join(getProjectsDir(userDataPath), `${id}.json`);
    if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
    }
    const items = readIndex(userDataPath).filter((i) => i.id !== id);
    writeIndex(userDataPath, items);
}
