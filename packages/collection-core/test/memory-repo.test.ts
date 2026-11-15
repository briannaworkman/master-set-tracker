import { createMemoryRepo } from '../src/db/memory-repo';
import { runRepoContract } from './repo.contract';

runRepoContract('memory', () => createMemoryRepo());
