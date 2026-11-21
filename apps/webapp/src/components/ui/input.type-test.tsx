import { Input, NativeTemporalInput, type NativeTemporalInputType } from './input';

// Positive control: non-temporal types are accepted on Input.
export const acceptsText = <Input type="text" />;

// Negative: a literal temporal type is rejected by Input.
// @ts-expect-error native temporal types are not allowed on Input
// eslint-disable-next-line no-restricted-syntax -- intentional violation under type test
export const rejectsDateLiteral = <Input type="date" />;

// Negative: a computed temporal value is rejected by Input.
const dynamicDate: NativeTemporalInputType = 'date';
// @ts-expect-error native temporal types are not allowed on Input
export const rejectsDynamicDate = <Input type={dynamicDate} />;

// Positive: the escape hatch accepts temporal types.
// eslint-disable-next-line no-restricted-syntax -- intentional use of escape hatch under type test
export const allowsNativeDate = <NativeTemporalInput type="date" />;
