import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Must import after mocks are set up
import CliAuthPage from './page';

// Mock next/navigation
const mockPush = vi.fn();
const mockSearchParams = new URLSearchParams('request=test-request-id');

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
  useSearchParams: () => mockSearchParams,
}));

// Mock auth state
const mockAuthState = { state: 'authenticated' as const };

vi.mock('@/modules/auth/AuthProvider', () => ({
  useAuthState: () => mockAuthState,
}));

// Mock convex hooks
const mockRequestDetails = {
  found: true,
  status: 'pending',
  deviceName: 'Test Device',
  cliVersion: '1.0.0',
  createdAt: Date.now() - 10000,
  expiresAt: Date.now() + 290000, // 5 minutes from now
  isExpired: false,
};

const mockApproveRequest = vi.fn();

vi.mock('convex/react', () => ({
  useQuery: vi.fn(() => mockRequestDetails),
  useMutation: vi.fn(() => mockApproveRequest),
}));

describe('CliAuthPage - render order fix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mock localStorage for sessionId
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: vi.fn(() => 'test-session-id'),
      },
      writable: true,
    });
  });

  it('shows approval UI when status is pending', async () => {
    const { useQuery } = await import('convex/react');
    (useQuery as any).mockReturnValue({
      found: true,
      status: 'pending',
      deviceName: 'Test Device',
      cliVersion: '1.0.0',
      expiresAt: Date.now() + 290000,
      isExpired: false,
    });

    render(<CliAuthPage />);

    await waitFor(() => {
      expect(screen.getByText('Authorize CLI')).toBeInTheDocument();
      expect(screen.getByText('Approve')).toBeInTheDocument();
      expect(screen.getByText('Deny')).toBeInTheDocument();
    });
  });

  it('shows success screen after fresh approval, not "Already Approved"', async () => {
    const user = userEvent.setup();
    const { useQuery } = await import('convex/react');

    // Start with pending status
    (useQuery as any).mockReturnValue({
      found: true,
      status: 'pending',
      deviceName: 'Test Device',
      cliVersion: '1.0.0',
      expiresAt: Date.now() + 290000,
      isExpired: false,
    });

    // Mock the approve mutation to succeed
    mockApproveRequest.mockResolvedValue({
      success: true,
    });

    render(<CliAuthPage />);

    // Wait for approval UI
    await waitFor(() => {
      expect(screen.getByText('Approve')).toBeInTheDocument();
    });

    // Click approve
    const approveButton = screen.getByText('Approve');
    await user.click(approveButton);

    // Simulate the reactive query update to 'approved' status
    // This happens AFTER the mutation resolves but potentially BEFORE setResult fires
    (useQuery as any).mockReturnValue({
      found: true,
      status: 'approved',
      deviceName: 'Test Device',
      cliVersion: '1.0.0',
      expiresAt: Date.now() + 290000,
      isExpired: false,
    });

    // Wait for success screen to appear
    await waitFor(() => {
      expect(screen.getByText('Done!')).toBeInTheDocument();
      expect(screen.getByText(/CLI authorized successfully/)).toBeInTheDocument();
    });

    // Verify "Already Approved" does NOT appear
    expect(screen.queryByText('Already Approved')).not.toBeInTheDocument();
  });

  it('shows "Already Approved" for stale URL (no local action)', async () => {
    const { useQuery } = await import('convex/react');

    // Status is already approved on first render (stale URL)
    (useQuery as any).mockReturnValue({
      found: true,
      status: 'approved',
      deviceName: 'Test Device',
      cliVersion: '1.0.0',
      expiresAt: Date.now() + 290000,
      isExpired: false,
    });

    render(<CliAuthPage />);

    await waitFor(() => {
      expect(screen.getByText('Already Approved')).toBeInTheDocument();
      expect(
        screen.getByText('This authorization request has already been approved.')
      ).toBeInTheDocument();
    });

    // Verify "Done!" does NOT appear
    expect(screen.queryByText('Done!')).not.toBeInTheDocument();
  });

  it('shows "Already Denied" for stale URL with denied status', async () => {
    const { useQuery } = await import('convex/react');

    // Status is already denied on first render
    (useQuery as any).mockReturnValue({
      found: true,
      status: 'denied',
      deviceName: 'Test Device',
      cliVersion: '1.0.0',
      expiresAt: Date.now() + 290000,
      isExpired: false,
    });

    render(<CliAuthPage />);

    await waitFor(() => {
      expect(screen.getByText('Already Denied')).toBeInTheDocument();
      expect(screen.getByText('This authorization request was denied.')).toBeInTheDocument();
    });
  });

  it('shows processing state while action is in flight', async () => {
    const user = userEvent.setup();
    const { useQuery } = await import('convex/react');

    (useQuery as any).mockReturnValue({
      found: true,
      status: 'pending',
      deviceName: 'Test Device',
      cliVersion: '1.0.0',
      expiresAt: Date.now() + 290000,
      isExpired: false,
    });

    // Make the mutation hang (don't resolve) to keep actionState in flight
    mockApproveRequest.mockImplementation(
      () => new Promise(() => {}) // Never resolves
    );

    render(<CliAuthPage />);

    await waitFor(() => {
      expect(screen.getByText('Approve')).toBeInTheDocument();
    });

    const approveButton = screen.getByText('Approve');
    await user.click(approveButton);

    // Should show processing state
    await waitFor(() => {
      expect(screen.getByText('Approving...')).toBeInTheDocument();
    });

    // Should NOT show "Already Approved" even if the query updates
    expect(screen.queryByText('Already Approved')).not.toBeInTheDocument();
  });
});
