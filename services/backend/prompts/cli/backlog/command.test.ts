import { describe, expect, test } from 'vitest';

import { backlogAddCommand, backlogUpdateCommand } from './command';
import { BACKLOG_STDIN_DELIMITER } from '../stdin-heredoc';

describe('backlogAddCommand', () => {
  test('uses namespaced heredoc delimiter', () => {
    const command = backlogAddCommand({ cliEnvPrefix: '' });
    expect(command).toContain(`<< '${BACKLOG_STDIN_DELIMITER}'`);
    expect(command).toContain(BACKLOG_STDIN_DELIMITER);
    expect(command).not.toContain("<< 'EOF'");
  });
});

describe('backlogUpdateCommand', () => {
  test('uses namespaced heredoc delimiter', () => {
    const command = backlogUpdateCommand({ cliEnvPrefix: 'PREFIX=' });
    expect(command).toContain('PREFIX=');
    expect(command).toContain('--backlog-item-id=<id>');
    expect(command).toContain(BACKLOG_STDIN_DELIMITER);
  });
});
