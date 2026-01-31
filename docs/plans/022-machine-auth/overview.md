# Machine Authentication - Overview

## Summary

This plan introduces user-machine authentication and authorization, enabling users to register and manage machines that can receive and execute commands from the chatroom UI. This creates a secure bridge between the web interface and CLI-based agents running on user machines.

## Goals

1. **Machine Registration** - Allow users to register their machines with the chatroom system
2. **Machine Discovery** - Display registered machines in the user's UI
3. **Secure Command Execution** - Enable the UI to send whitelisted commands to registered machines
4. **Real-time Communication** - Establish WebSocket/subscription-based command delivery from backend to CLI

## Non-Goals

1. **Arbitrary Command Execution** - Users cannot type arbitrary commands; only pre-defined, backend-controlled commands are permitted
2. **Multi-user Machine Access** - Each machine is owned by a single user; no shared machine access
3. **Complex Command Pipelines** - This iteration only supports single, simple commands (test command)
4. **Offline Command Queuing** - Commands are only delivered when the machine is actively connected
