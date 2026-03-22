import { api } from '@workspace/backend/convex/_generated/api';
import { useSessionMutation, useSessionQuery } from 'convex-helpers/react/sessions';
import { useSearchParams } from 'next/navigation';
import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';

// Define the presentation state type to include activePresentation
type PresentationState = {
  key: string;
  currentSlide: number;
  lastUpdated: number;
  exists: boolean;
  activePresentation?: {
    presenterId: string;
  };
  _id?: unknown;
  _creationTime?: number;
};

export function usePresentationSync({
  key,
  initialSlide = 1,
  totalSlides,
}: {
  key: string;
  initialSlide?: number;
  totalSlides: number;
}) {
  // Internal state for current slide (this is the source of truth)
  const [currentSlide, setCurrentSlideInternal] = useState(initialSlide);

  // Track the timestamp of the last local slide change
  const [lastChangeTimestamp, setLastChangeTimestamp] = useState<number>(Date.now());

  // Track if the user has explicitly chosen to navigate independently when a presentation is active
  const [explicitSoloMode, setExplicitSoloMode] = useState(false);

  // Track if we're currently processing an update to avoid loops
  const updatingRef = useRef(false);

  // Track previous presentation state to detect changes
  const prevPresentationActiveRef = useRef<boolean | null>(null);

  // Get URL parameters to check sync status
  const searchParams = useSearchParams();
  const slideParam = searchParams.get('slide');

  // Always enable sync since presentationKey is mandatory
  const isSyncEnabled = true;

  const [prevSlideParam, setPrevSlideParam] = useState(slideParam);
  if (prevSlideParam !== slideParam) {
    setPrevSlideParam(slideParam);
    if (!updatingRef.current && slideParam) {
      const slideFromUrl = Number.parseInt(slideParam, 10);
      if (
        !Number.isNaN(slideFromUrl) &&
        slideFromUrl >= 1 &&
        slideFromUrl <= totalSlides &&
        slideFromUrl !== currentSlide
      ) {
        setCurrentSlideInternal(slideFromUrl);
        setLastChangeTimestamp(Date.now());
      }
    }
  }

  // Update URL when slide changes (using replaceState to avoid browser history entries)
  const updateUrlWithSlide = useCallback((slideNumber: number) => {
    if (typeof window === 'undefined') return;

    const params = new URLSearchParams(window.location.search);
    params.set('slide', slideNumber.toString());
    const newUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState({}, '', newUrl);
  }, []);

  // Get current state from backend using session query
  const presentationState = useSessionQuery(
    api.presentations.getPresentationState,
    isSyncEnabled ? { key } : 'skip'
  ) as PresentationState | undefined;

  // Mutations to update backend using session mutations
  const updateSlide = useSessionMutation(api.presentations.setCurrentSlide);
  const startPresentingMutation = useSessionMutation(api.presentations.startPresenting);
  const stopPresentingMutation = useSessionMutation(api.presentations.stopPresenting);

  // Get session ID from auth state
  const authState = useSessionQuery(api.auth.getState);
  const sessionId = authState?.sessionId || '';

  // Determine if there's an active presentation and if we're the presenter
  const isPresenter = presentationState?.activePresentation?.presenterId === sessionId;
  const isPresentationActive = !!presentationState?.activePresentation;

  // Derive solo mode:
  // - Always in solo mode if no active presentation
  // - In solo mode if user explicitly chose it while a presentation is active
  // - Presenter is never in solo mode
  const isSoloMode = !isPresentationActive || (explicitSoloMode && !isPresenter);

  // User is following if there's an active presentation, they're not the presenter, and not in solo mode
  const isFollowing = isPresentationActive && !isPresenter && !isSoloMode;

  if (presentationState && prevPresentationActiveRef.current === null) {
    prevPresentationActiveRef.current = !!presentationState.activePresentation;
  }

  // Sync to backend
  const syncToBackend = useCallback(
    (slideNumber: number, timestamp: number) => {
      if (!key) return;

      // Only sync to backend if user is presenter or there's no active presentation
      if (isPresenter || !isPresentationActive) {
        updateSlide({
          key,
          slide: slideNumber - 1,
          timestamp,
        });
      }
    },
    [key, updateSlide, isPresenter, isPresentationActive]
  );

  // Set the slide with side effects (URL update, backend sync)
  const setCurrentSlide = useCallback(
    (
      slideNumber: number,
      { fromBackend = false, updateUrl = true, updateBackend = true, timestamp = Date.now() } = {}
    ) => {
      try {
        updatingRef.current = true;

        // Validate and clamp slide number
        const validSlide = Math.max(1, Math.min(slideNumber, totalSlides));

        // For local changes, always update the timestamp
        if (!fromBackend) {
          setLastChangeTimestamp(timestamp);
        }

        // Update internal state
        setCurrentSlideInternal(validSlide);

        // Update URL if needed
        if (updateUrl) {
          updateUrlWithSlide(validSlide);
        }

        // Update backend if needed and not originated from backend
        if (updateBackend && !fromBackend) {
          syncToBackend(validSlide, timestamp);
        }
      } finally {
        // Use a small timeout to ensure state updates complete
        // before we start listening to further changes
        setTimeout(() => {
          updatingRef.current = false;
        }, 100);
      }
    },
    [totalSlides, updateUrlWithSlide, syncToBackend]
  );

  // Navigation methods
  const nextSlide = useCallback(() => {
    if (currentSlide < totalSlides) {
      const now = Date.now();

      // If we're a viewer and not explicitly in solo mode, set explicit solo mode when navigating
      if (isPresentationActive && !isPresenter && !explicitSoloMode) {
        setExplicitSoloMode(true);
      }

      setCurrentSlide(currentSlide + 1, { timestamp: now });
    }
  }, [
    currentSlide,
    totalSlides,
    setCurrentSlide,
    isPresentationActive,
    isPresenter,
    explicitSoloMode,
  ]);

  const previousSlide = useCallback(() => {
    if (currentSlide > 1) {
      const now = Date.now();

      // If we're a viewer and not explicitly in solo mode, set explicit solo mode when navigating
      if (isPresentationActive && !isPresenter && !explicitSoloMode) {
        setExplicitSoloMode(true);
      }

      setCurrentSlide(currentSlide - 1, { timestamp: now });
    }
  }, [currentSlide, setCurrentSlide, isPresentationActive, isPresenter, explicitSoloMode]);

  const goToSlide = useCallback(
    (index: number) => {
      const now = Date.now();

      // If we're a viewer and not explicitly in solo mode, set explicit solo mode when navigating
      if (isPresentationActive && !isPresenter && !explicitSoloMode) {
        setExplicitSoloMode(true);
      }

      setCurrentSlide(index, { timestamp: now });
    },
    [setCurrentSlide, isPresentationActive, isPresenter, explicitSoloMode]
  );

  const [prevPresentationState, setPrevPresentationState] = useState(presentationState);
  if (prevPresentationState !== presentationState) {
    setPrevPresentationState(presentationState);
    if (presentationState && !updatingRef.current && !isSoloMode) {
      const backendSlide = presentationState.currentSlide + 1;
      if ('lastUpdated' in presentationState) {
        const backendTimestamp = presentationState.lastUpdated;
        if (backendSlide !== currentSlide && backendTimestamp > lastChangeTimestamp) {
          setCurrentSlide(backendSlide, {
            fromBackend: true,
            updateBackend: false,
            timestamp: backendTimestamp,
          });
        }
      }
    }
  }

  // Detect presentation state transitions during render
  if (presentationState) {
    const wasActive = prevPresentationActiveRef.current;
    const isActive = !!presentationState.activePresentation;

    if (wasActive === true && !isActive) {
      setExplicitSoloMode(false);
      if (!isPresenter) {
        // Schedule toast for after render
        queueMicrotask(() => {
          toast.info('Presentation ended', {
            description: 'The presenter has ended the presentation.',
            duration: 5000,
          });
        });
      }
    }

    prevPresentationActiveRef.current = isActive;
  }

  // Function to start presenting
  const startPresenting = useCallback(async () => {
    if (!key) return;

    // Reset explicit solo mode when starting to present
    setExplicitSoloMode(false);

    await startPresentingMutation({
      key,
    });
  }, [key, startPresentingMutation]);

  // Function to stop presenting
  const stopPresenting = useCallback(async () => {
    if (!key) return;

    await stopPresentingMutation({
      key,
    });
  }, [key, stopPresentingMutation]);

  // Function to follow presenter
  const followPresenter = useCallback(() => {
    // Only allow following if there's an active presentation
    if (isPresentationActive) {
      setExplicitSoloMode(false);
    }
  }, [isPresentationActive]);

  return {
    currentSlide,
    setCurrentSlide,
    nextSlide,
    previousSlide,
    goToSlide,
    isConnected: !!presentationState,
    sessionId,
    isPresenter,
    isPresentationActive,
    isFollowing,
    isSoloMode,
    startPresenting,
    stopPresenting,
    followPresenter,
  };
}
