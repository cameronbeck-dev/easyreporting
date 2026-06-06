// This is the ONLY way routes should obtain a DataProvider.
// Never instantiate CsvProvider directly elsewhere.
import type { UserContext } from '../auth/types';
import type { DataProvider } from './DataProvider';
import { AccessControlledProvider } from './AccessControlledProvider';
import { CsvProvider } from './CsvProvider';

export function getProvider(ctx: UserContext): DataProvider {
  return new AccessControlledProvider(new CsvProvider(), ctx);
}
