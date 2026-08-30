/** Stable doctor façade. Internal responsibilities live in focused modules. */
export {
  DOCTOR_SCHEMA_VERSION,
  DoctorExitCode,
  doctorHelp,
  formatDoctorCliError,
  formatDoctorResult,
  parseDoctorArgs,
} from './doctor-contract';
export type {
  DoctorCheck,
  DoctorCheckCategory,
  DoctorCheckStatus,
  DoctorCliOptions,
  DoctorCliParseResult,
  DoctorClient,
  DoctorDependencies,
  DoctorError,
  DoctorExitCodeValue,
  DoctorOptions,
  DoctorQueryResult,
  DoctorResult,
  DoctorStatus,
  DoctorSummary,
  DoctorTarget,
} from './doctor-contract';
export { runDoctor } from './doctor-runner';
