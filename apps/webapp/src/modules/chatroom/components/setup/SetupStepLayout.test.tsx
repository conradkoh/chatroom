import { render } from '@testing-library/react';
import { createRef, type ReactNode, type Ref } from 'react';
import { describe, expect, it } from 'vitest';

import { SetupStepFooter, SetupStepLayout } from './SetupStepLayout';

function renderStep(footer?: ReactNode, bodyRef?: Ref<HTMLDivElement>) {
  return render(
    <SetupStepLayout bodyRef={bodyRef} footer={footer}>
      <p>Body content</p>
    </SetupStepLayout>
  );
}

describe('SetupStepLayout', () => {
  it('renders the footer after the scrolling body', () => {
    const { container } = renderStep(
      <SetupStepFooter primary={<button type="button">Continue</button>} />
    );

    const body = container.querySelector('[data-slot="setup-step-body"]');
    const footer = container.querySelector('[data-slot="setup-step-footer"]');
    expect(body).not.toBeNull();
    expect(footer).not.toBeNull();
    expect(body!.compareDocumentPosition(footer!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('places the secondary action before the primary action', () => {
    const { container } = renderStep(
      <SetupStepFooter
        secondary={<button type="button">Back</button>}
        primary={<button type="button">Continue</button>}
      />
    );

    const back = container.querySelectorAll('button')[0];
    const next = container.querySelectorAll('button')[1];
    expect(back?.textContent).toBe('Back');
    expect(next?.textContent).toBe('Continue');
    expect(back!.compareDocumentPosition(next!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('omits the secondary cell when there is no secondary action', () => {
    const { container } = renderStep(
      <SetupStepFooter primary={<button type="button">Continue</button>} />
    );

    const footer = container.querySelector('[data-slot="setup-step-footer"]');
    expect(footer?.children).toHaveLength(1);
    expect(footer?.textContent).toBe('Continue');
  });

  it('attaches bodyRef to the scrolling body element', () => {
    const bodyRef = createRef<HTMLDivElement>();
    const { container } = renderStep(undefined, bodyRef);

    expect(bodyRef.current).toBe(container.querySelector('[data-slot="setup-step-body"]'));
  });

  it('renders no footer when none is given', () => {
    const { container } = renderStep(undefined);

    expect(container.querySelector('[data-slot="setup-step-footer"]')).toBeNull();
  });
});
