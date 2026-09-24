<!-- This file is intentionally left blank. EpisodeList.vue has been removed.
     The Episode Queue manages episode display internally via EpisodeQueue.vue. -->
                        <th class="text-left text-sm font-medium px-3 py-2 w-28">Status</th>
                    </tr>
                </thead>
                <tbody>
                    <tr
                        v-for="episode in episodes"
                        :key="episode.id"
                        class="border-t hover:bg-muted/50"
                        :class="{ 'opacity-50': !episode.enabled }"
                    >
                        <!-- Enable checkbox -->
                        <td class="px-3 py-2">
                            <input
                                type="checkbox"
                                class="h-4 w-4 rounded border-input"
                                :checked="episode.enabled"
                                @change="toggleEnabled(episode)"
                            />
                        </td>

                        <!-- Season (editable) -->
                        <td class="px-3 py-2">
                            <input
                                type="number"
                                min="0"
                                class="w-12 px-1 py-0.5 text-sm border rounded bg-background text-center"
                                :value="getOverride(episode.sourceFile)?.season ?? episode.seasonNumber"
                                @change="updateManualOverride(episode.sourceFile, 'season', Number(($event.target as HTMLInputElement).value) || 1)"
                            />
                        </td>

                        <!-- Episode (editable) -->
                        <td class="px-3 py-2">
                            <input
                                v-if="episode.episodeNumber > 0"
                                type="number"
                                min="0"
                                class="w-12 px-1 py-0.5 text-sm border rounded bg-background text-center"
                                :value="getOverride(episode.sourceFile)?.episode ?? episode.episodeNumber"
                                @change="updateManualOverride(episode.sourceFile, 'episode', Number(($event.target as HTMLInputElement).value) || 0)"
                            />
                            <span v-else class="text-sm text-muted-foreground italic">
                                <input
                                    type="number"
                                    min="0"
                                    class="w-12 px-1 py-0.5 text-sm border rounded bg-background text-center"
                                    placeholder="?"
                                    @change="updateManualOverride(episode.sourceFile, 'episode', Number(($event.target as HTMLInputElement).value) || 0)"
                                />
                            </span>
                        </td>

                        <!-- Title -->
                        <td class="px-3 py-2 text-sm">
                            <span v-if="episode.title">{{ episode.title }}</span>
                            <span v-else class="text-muted-foreground italic">—</span>
                        </td>

                        <!-- Source file -->
                        <td class="px-3 py-2 text-sm text-muted-foreground truncate max-w-[12rem]">
                            {{ episode.sourceFile }}
                        </td>

                        <!-- Stream badges -->
                        <td class="px-3 py-2">
                            <div class="flex items-center gap-1">
                                <span v-if="episode.streamCounts.video > 0"
                                    class="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                                    V:{{ episode.streamCounts.video }}
                                </span>
                                <span v-if="episode.streamCounts.audio > 0"
                                    class="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">
                                    A:{{ episode.streamCounts.audio }}
                                </span>
                                <span v-if="episode.streamCounts.subtitle > 0"
                                    class="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300">
                                    S:{{ episode.streamCounts.subtitle }}
                                </span>
                                <span v-if="episode.streamCounts.attachment > 0"
                                    class="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300">
                                    AT:{{ episode.streamCounts.attachment }}
                                </span>
                                <span v-if="episode.streamCounts.video + episode.streamCounts.audio + episode.streamCounts.subtitle + episode.streamCounts.attachment === 0"
                                    class="text-xs text-muted-foreground">
                                    —
                                </span>
                            </div>
                        </td>

                        <!-- Status badge -->
                        <td class="px-3 py-2">
                            <span
                                class="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium"
                                :class="getStatusBadgeClass(episode.status)"
                            >
                                {{ episode.status }}
                            </span>
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>

        <!-- Unassigned warning -->
        <div v-if="unassignedCount > 0" class="flex items-center gap-2 p-3 rounded-lg border border-yellow-200 bg-yellow-50 dark:border-yellow-900 dark:bg-yellow-950 text-sm">
            <span class="text-yellow-700 dark:text-yellow-300">
                ⚠ {{ unassignedCount }} episode(s) could not be automatically assigned. Edit the episode number manually in the table above.
            </span>
        </div>
    </div>
</template>
