import type { MappingConversation } from './types';

export const findConversationRoot = (value: unknown): MappingConversation | null => {
  const queue: unknown[] = [value];
  const visited = new WeakSet<object>();

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== 'object') {
      continue;
    }

    if (visited.has(current)) {
      continue;
    }
    visited.add(current);

    const record = current as Record<string, unknown>;
    if (
      typeof record.current_node === 'string' &&
      record.mapping &&
      typeof record.mapping === 'object'
    ) {
      return record as MappingConversation;
    }

    Object.values(record).forEach((entry) => {
      if (entry && typeof entry === 'object') {
        queue.push(entry);
      }
    });
  }

  return null;
};
