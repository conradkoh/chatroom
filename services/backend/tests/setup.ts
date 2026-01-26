// Suppress console logs during testing to reduce noise
if (process.env.NODE_ENV === 'test') {
  const originalConsoleLog = console.log;
  const originalConsoleWarn = console.warn;
  const originalConsoleError = console.error;

  // Filter out FSM transition logs
  const shouldSuppressLog = (message: string) => {
    return (
      typeof message === 'string' &&
      message.includes('[FSM] Task') &&
      message.includes('transitioned:')
    );
  };

  console.log = (...args: any[]) => {
    if (args.length > 0 && shouldSuppressLog(args[0])) {
      return; // Suppress FSM transition logs
    }
    originalConsoleLog.apply(console, args);
  };

  console.warn = (...args: any[]) => {
    if (args.length > 0 && shouldSuppressLog(args[0])) {
      return; // Suppress FSM transition logs
    }
    originalConsoleWarn.apply(console, args);
  };

  console.error = (...args: any[]) => {
    if (args.length > 0 && shouldSuppressLog(args[0])) {
      return; // Suppress FSM transition logs
    }
    originalConsoleError.apply(console, args);
  };
}
