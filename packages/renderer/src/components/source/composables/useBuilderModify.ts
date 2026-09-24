import { type Ref } from 'vue';
import type { StreamItem, DispositionOption, TagEntry } from '@/components/source/types/stream-match-constants';
import { DISPOSITION_OPTIONS } from '@/components/source/config/disposition-options';

interface ModifyContext {
    items: Ref<StreamItem[]>;
    emitChange: () => void;
}

export function useBuilderModify(
    _props: { streamType: string },
    ctx: ModifyContext,
) {
    const { emitChange } = ctx;

    // ─── Modify CRUD ────────────────────────────────────────────

    function getModify(item: StreamItem): Record<string, unknown> {
        if (!item.modify) {
            item.modify = {};
            emitChange();
        }
        return item.modify;
    }

    function setModifyField(item: StreamItem, field: string, value: unknown) {
        const modify = getModify(item);
        if (value === null || value === undefined) {
            delete modify[field];
            if (Object.keys(modify).length === 0) {
                item.modify = undefined;
            }
        } else {
            modify[field] = value;
        }
        emitChange();
    }

    function handleModifyJsonChange(item: StreamItem, newVal: unknown) {
        if (newVal && typeof newVal === 'object') {
            const obj = newVal as Record<string, unknown>;
            if (Object.keys(obj).length === 0) {
                item.modify = undefined;
            } else {
                item.modify = obj;
            }
            emitChange();
        }
    }

    // ─── Preprocess CRUD ────────────────────────────────────────

    function getPreprocess(item: StreamItem): Record<string, unknown> {
        if (!item.preprocess) {
            item.preprocess = {};
            emitChange();
        }
        return item.preprocess;
    }

    function setPreprocessField(item: StreamItem, field: string, value: unknown) {
        const preprocess = getPreprocess(item);
        let opus = preprocess['opusenc'] as Record<string, unknown> | undefined;
        if (!opus) {
            opus = {};
            preprocess['opusenc'] = opus;
        }
        if (value === '' || value === undefined || value === null || value === false) {
            delete opus[field];
            if (Object.keys(opus).length === 0) {
                delete preprocess['opusenc'];
            }
            if (Object.keys(preprocess).length === 0) {
                item.preprocess = undefined;
            }
        } else {
            opus[field] = value;
        }
        emitChange();
    }

    function handlePreprocessJsonChange(item: StreamItem, newVal: unknown) {
        if (newVal && typeof newVal === 'object') {
            const obj = newVal as Record<string, unknown>;
            if (Object.keys(obj).length === 0) {
                item.preprocess = undefined;
            } else {
                item.preprocess = obj;
            }
            emitChange();
        }
    }

    function getPreprocessOpens(item: StreamItem, field: string): unknown {
        const opus = item.preprocess?.opusenc as Record<string, unknown> | undefined;
        if (!opus) return '';
        return opus[field] ?? '';
    }

    // ─── Disposition helpers (modify panel) ─────────────────────

    function getActiveDispositionLabels(item: StreamItem): DispositionOption[] {
        const disp = item.modify?.disposition as Record<string, unknown> | undefined;
        if (!disp) return [];
        return DISPOSITION_OPTIONS
            .filter((d) => {
                const selector = disp[d.value];
                if (selector === undefined) return false;
                if (typeof selector === 'boolean') return selector === true;
                if (typeof selector !== 'object' || selector === null) return false;
                if ('equal' in selector) return selector.equal === true;
                if ('not' in selector) {
                    const inner = selector.not as Record<string, unknown>;
                    if ('equal' in inner) return inner.equal !== true;
                }
                return false;
            })
            .map((d) => ({ ...d }));
    }

    function toggleDisposition(item: StreamItem, dispKey: string) {
        const modify = getModify(item);
        const current = (modify['disposition'] as Record<string, unknown> | undefined) ?? {};

        if (dispKey in current) {
            const next = { ...current };
            delete next[dispKey];
            if (Object.keys(next).length === 0) {
                setModifyField(item, 'disposition', undefined);
                return;
            }
            modify['disposition'] = next;
        } else {
            modify['disposition'] = { ...current, [dispKey]: true };
        }
        emitChange();
    }

    function removeDisposition(item: StreamItem, dispKey: string) {
        const modify = getModify(item);
        const current = (modify['disposition'] as Record<string, unknown> | undefined) ?? {};
        const next = { ...current };
        delete next[dispKey];
        if (Object.keys(next).length === 0) {
            setModifyField(item, 'disposition', undefined);
        } else {
            modify['disposition'] = next;
            emitChange();
        }
    }

    function getAvailableDispositions(item: StreamItem): DispositionOption[] {
        const disp = item.modify?.disposition as Record<string, unknown> | undefined;
        if (!disp) return DISPOSITION_OPTIONS;
        return DISPOSITION_OPTIONS.filter((d) => {
            const selector = disp[d.value];
            if (selector === undefined) return true;
            if (typeof selector === 'boolean') return !selector;
            if (typeof selector !== 'object' || selector === null) return true;
            if ('equal' in selector) return selector.equal !== true;
            if ('not' in selector) {
                const inner = selector.not as Record<string, unknown>;
                if ('equal' in inner) return inner.equal === true;
            }
            return true;
        });
    }

    function updateDispositionValue(item: StreamItem, dispKey: string, value: boolean) {
        const modify = getModify(item);
        const current = (modify['disposition'] as Record<string, unknown> | undefined);
        if (current === undefined || !(dispKey in current)) return;
        modify['disposition'] = { ...current, [dispKey]: value };
        emitChange();
    }

    // ─── Tags ───────────────────────────────────────────────────

    function setModifyTag(item: StreamItem, key: string, value: string) {
        const modify = getModify(item);
        let tags = modify['tags'] as Record<string, string> | undefined;
        if (!tags) {
            tags = {};
            modify['tags'] = tags;
        }
        if (value === '') {
            delete tags[key];
        } else {
            tags[key] = value;
        }
        if (Object.keys(tags).length === 0) {
            delete modify['tags'];
        }
        if (Object.keys(modify).length === 0) {
            item.modify = undefined;
        }
        emitChange();
    }

    function getTagEntries(item: StreamItem): TagEntry[] {
        const modify = item.modify;
        if (!modify?.tags || typeof modify.tags !== 'object') return [];
        return Object.entries(modify.tags as Record<string, string>).map(([k, v]) => ({ key: k, value: v }));
    }

    function addTag(item: StreamItem) {
        const modify = getModify(item);
        let tags = modify['tags'] as Record<string, string> | undefined;
        if (!tags) {
            tags = {};
            modify['tags'] = tags;
        }
        const baseKey = 'tag';
        let i = 1;
        while (tags[`${baseKey}${i}`] !== undefined) { i++; }
        tags[`${baseKey}${i}`] = '';
        emitChange();
    }

    function removeTag(item: StreamItem, key: string) {
        const modify = item.modify as Record<string, unknown> | undefined;
        if (!modify?.tags) return;
        const tags = modify.tags as Record<string, string>;
        delete tags[key];
        if (Object.keys(tags).length === 0) {
            delete modify['tags'];
        }
        if (Object.keys(modify).length === 0) {
            item.modify = undefined;
        }
        emitChange();
    }

    function renameTag(item: StreamItem, oldKey: string, newKey: string, _tagIdx: number) {
        const modify = item.modify as Record<string, unknown> | undefined;
        if (!modify?.tags) return;
        const tags = modify.tags as Record<string, string>;
        if (oldKey === newKey || newKey === '') return;
        const value = tags[oldKey];
        if (value !== undefined) {
            delete tags[oldKey];
            tags[newKey] = value;
        }
        emitChange();
    }

    // ─── Return ─────────────────────────────────────────────────

    return {
        setModifyField,
        setPreprocessField,
        handleModifyJsonChange,
        handlePreprocessJsonChange,
        getPreprocessOpens,

        getActiveDispositionLabels,
        toggleDisposition,
        removeDisposition,
        getAvailableDispositions,
        updateDispositionValueToModify: updateDispositionValue,

        getTagEntries,
        addTag,
        removeTag,
        renameTag,
        setModifyTag,
    };
}
