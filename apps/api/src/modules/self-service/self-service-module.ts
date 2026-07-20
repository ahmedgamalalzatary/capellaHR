import {
  createSelfServiceService,
  type SelfServiceDependencies,
} from './self-service-service.js';

export const createSelfServiceModule = (dependencies: SelfServiceDependencies) => ({
  service: createSelfServiceService(dependencies),
});

