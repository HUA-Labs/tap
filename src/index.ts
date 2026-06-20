export type {
  RuntimeName,
  BridgeMode,
  Platform,
  InstanceId,
  AdapterContext,
  ProbeResult,
  PatchPlan,
  PatchOp,
  PatchOpType,
  OwnedArtifact,
  ArtifactKind,
  ApplyResult,
  VerifyResult,
  VerifyCheck,
  RuntimeAdapter,
  TapState,
  TapStateV1,
  InstanceState,
  /** @deprecated Use InstanceState. Will be removed in 0.2.0. */
  RuntimeState,
  BridgeState,
  AppServerState,
  AppServerAuthState,
  CommandName,
  CommandCode,
  CommandResult,
} from "./types.js";

export {
  loadState,
  saveState,
  createInitialState,
  stateExists,
} from "./state.js";
export { version } from "./version.js";
export type {
  GeminiIdeCompanionServer,
  GeminiIdeCompanionServerOptions,
  GeminiIdeContext,
  GeminiIdeCursor,
  GeminiIdeFile,
  GeminiIdeInfo,
} from "./bridges/gemini-ide-companion.js";
export { startGeminiIdeCompanionServer } from "./bridges/gemini-ide-companion.js";

// Config
export type {
  TapSharedConfig,
  TapLocalConfig,
  TapResolvedConfig,
  ConfigSource,
  ConfigResolution,
  ConfigOverrides,
} from "./config/index.js";
export {
  resolveConfig,
  loadSharedConfig,
  loadLocalConfig,
  saveSharedConfig,
  saveLocalConfig,
  SHARED_CONFIG_FILE,
  LOCAL_CONFIG_FILE,
} from "./config/index.js";
export { normalizeTapPath } from "./utils.js";

// Bridge engine
export {
  /** @deprecated Internal use only. Will be removed in 0.2.0. */
  updateBridgeHeartbeat,
  getHeartbeatAge,
} from "./engine/bridge-observability.js";
export { rotateLog, restartBridge } from "./engine/bridge.js";

// Dashboard / State API
export type {
  AgentInfo,
  BridgeInfo,
  PRInfo,
  DashboardWarning,
  DashboardSnapshot,
} from "./engine/dashboard.js";
export { collectDashboardSnapshot } from "./engine/dashboard.js";

// Observe transport (experimental Codex IPC binding remains observe-only)
export type {
  TransportAddress,
  ObserveTransportAgent,
  ObserveTransportConversation,
  ObserveTransportSnapshot,
  ObserveTransportEventKind,
  ObserveTransportEvent,
  ObserveTransportListener,
  ObserveTransport,
} from "./transport/types.js";
export type {
  CapabilityScope,
  ConsentReceipt,
  CreateConsentReceiptOptions,
  CreatedConsentReceipt,
  ConsumeConsentReceiptOptions,
} from "./transport/consent.js";
export {
  CONSENT_RECEIPTS_DIRNAME,
  DEFAULT_CONSENT_TTL_SECONDS,
  ConsentReceiptError,
  createConsentReceipt,
  consumeConsentReceipt,
} from "./transport/consent.js";
export type {
  CheckTrustedDeviceLeaseGateOptions,
  CheckTrustedDeviceLeaseOptions,
  TrustedDeviceLease,
  TrustedDeviceLeaseCheck,
  TrustedDeviceLeaseFailureReason,
  TrustedDeviceLeaseGateResult,
} from "./transport/trusted-device-lease.js";
export {
  TRUSTED_DEVICE_LEASES_DIRNAME,
  checkTrustedDeviceLease,
  checkTrustedDeviceLeaseGate,
  loadTrustedDeviceLease,
  parseTrustedDeviceLease,
  resolveTrustedDeviceLeasesDir,
} from "./transport/trusted-device-lease.js";
export type { FileObserveTransportOptions } from "./transport/file-observe-transport.js";
export {
  FileObserveTransport,
  createFileObserveTransport,
} from "./transport/file-observe-transport.js";
export type {
  CodexIpcBroadcastMessage,
  CodexIpcRequestMessage,
  CodexIpcResponseMessage,
  CodexIpcMessage,
  CodexIpcSocket,
  CodexIpcObserveTransportOptions,
} from "./transport/experimental/codex-ipc-observe.js";
export {
  DEFAULT_CODEX_IPC_PIPE_PATH,
  ExperimentalCodexIpcObserveTransport,
  createExperimentalCodexIpcObserveTransport,
  encodeCodexIpcFrame,
  decodeCodexIpcFrames,
} from "./transport/experimental/codex-ipc-observe.js";
export type { TapReceiveTransport } from "./routing/receive-transports.js";
export {
  inferReceiveTransports,
  normalizeReceiveTransports,
  prefersConsentDrive,
  canUseConsentDriveForAddress,
} from "./routing/receive-transports.js";
export type {
  PollingReceiverItem,
  MarkPollingReceiverItemsProcessedOptions,
  PollingReceiverMode,
  PollingReceiverState,
  RunPollingReceiverOptions,
  RunPollingReceiverResult,
} from "./receiver/codex-cli-polling-receiver.js";
export {
  buildPromptBundle,
  markPollingReceiverItemsProcessed,
  resolvePollingReceiverStatePath,
  runPollingReceiver,
} from "./receiver/codex-cli-polling-receiver.js";
export type {
  ProjectedEnvelopeBackfillInput,
  ProjectedEnvelopeBackfillResult,
} from "./receiver/projected-envelope-backfill.js";
export { writeProjectedEnvelopeBackfill } from "./receiver/projected-envelope-backfill.js";
export type {
  CodexCliAppServerPromotionResult,
  CodexAppServerPromoter,
  CodexAppServerPromotionDelivery,
  CodexAppServerPromotionRequest,
  RunCodexCliAppServerPromotionOptions,
} from "./receiver/codex-cli-app-server-promotion.js";
export {
  runCodexCliAppServerPromotion,
  WebSocketCodexAppServerPromoter,
} from "./receiver/codex-cli-app-server-promotion.js";
export type {
  RunSupervisedReceiverPromotionOptions,
  SupervisedReceiverPromotionMode,
  SupervisedReceiverPromotionResult,
} from "./receiver/supervised-receiver-promotion.js";
export { runSupervisedReceiverPromotion } from "./receiver/supervised-receiver-promotion.js";
export type {
  ProjectionDir,
  ProjectionItem,
  ProjectionMode,
  ProjectionState,
  ProjectionStateEntry,
  RunLocalProjectionOptions,
  RunLocalProjectionResult,
} from "./projection/local-receiver-projection.js";
export {
  resolveLocalProjectionStatePath,
  runLocalProjection,
} from "./projection/local-receiver-projection.js";
export type {
  RunLocalUplinkOptions,
  RunLocalUplinkResult,
  UplinkDir,
  UplinkItem,
  UplinkMode,
  UplinkState,
  UplinkStateEntry,
} from "./uplink/local-append-only-uplink.js";
export {
  resolveLocalUplinkStatePath,
  runLocalUplink,
} from "./uplink/local-append-only-uplink.js";
export type {
  MirrorRemoteUplinkSourceOptions,
  RemoteUplinkCommandResult,
  RemoteUplinkCommandRunner,
  RemoteUplinkMirrorRecord,
} from "./uplink/remote-uplink-source.js";
export { mirrorRemoteUplinkSource } from "./uplink/remote-uplink-source.js";
export type {
  CodexEndpointClassification,
  CodexEndpointProfile,
  ParsedCodexEndpointUrl,
  ResolveCodexEndpointProfileOptions,
  ResolvedCodexEndpointProfile,
} from "./routing/codex-endpoint-profiles.js";
export {
  classifyCodexEndpointUrl,
  CODEX_APP_SERVER_ENDPOINT_PROFILES,
  CODEX_ENDPOINT_PROFILE_ALIASES,
  getCodexEndpointProfile,
  listCodexEndpointProfiles,
  normalizeCodexEndpointProfileId,
  parseCodexEndpointUrl,
  resolveCodexEndpointProfile,
} from "./routing/codex-endpoint-profiles.js";
export type {
  CodexA2AAdapterKind,
  CodexA2ADeliveryRequest,
  CodexA2ADeliveryResult,
  CodexA2AFailureReason,
  CodexA2AMessageEnvelope,
  CodexA2ATargetTuple,
  CodexBinding,
  CodexBindingAddress,
  CodexBindingBlockReason,
  CodexBindingHeartbeat,
  CodexBindingRegistry,
  CodexBindingSource,
  CodexBindingStatus,
  BuildCodexBindingRegistryOptions,
  ConsentDriveReceipt,
  ConsentDriveResponse,
  ConsentDriveTransport,
  ConsentDriveTransportFactory,
  RemoteCodexRelayConfig,
  RemoteCodexRelayExecutor,
  RemoteCodexRelayInput,
  RemoteCodexRelayResult,
  ResolveCodexBindingOptions,
  ResolveCodexBindingResult,
  ResolveCodexBindingTarget,
} from "./codex-a2a/index.js";
export {
  buildCodexBindingRegistry,
  resolveCodexBinding,
} from "./codex-a2a/index.js";
export type {
  CodexOwnerDiscoveryResult,
  DiscoverCodexOwnerClientIdOptions,
} from "./routing/codex-owner-discovery.js";
export { discoverCodexOwnerClientId } from "./routing/codex-owner-discovery.js";
export type {
  RenderTapMessagePromptOptions,
  TapMessageViewModel,
  TapMessagePromptOptions,
  TapReturnAddress,
} from "./routing/tap-message-prompt.js";
export {
  buildTapMessagePrompt,
  createTapMessageViewModel,
  renderAgentMessagePrompt,
} from "./routing/tap-message-prompt.js";
export type {
  CodexIpcDriveMethod,
  CodexIpcSuggestionDraft,
  CodexIpcDriveActionResult,
  CodexIpcDraftActionOptions,
  CodexIpcDriveActionOptions,
  CodexIpcStartTurnOptions,
  CodexIpcDriveStartTurnOptions,
  CodexIpcCreateConsentReceiptOptions,
  CodexIpcControlTransportOptions,
} from "./transport/experimental/codex-ipc-control.js";
export {
  DEFAULT_CODEX_IPC_WINDOWS_PIPE_PATH,
  isCodexIpcDefaultSupported,
  resolveCodexIpcPath,
  type ResolveCodexIpcPathOptions,
} from "./transport/experimental/codex-ipc-endpoint.js";
export {
  CODEX_IPC_DRIVE_METHODS,
  ExperimentalCodexIpcControlTransport,
  createExperimentalCodexIpcControlTransport,
  buildFollowerStartTurnParams,
} from "./transport/experimental/codex-ipc-control.js";

// State/Control API (M105)
export type {
  StateApiOptions,
  EventStreamOptions,
  AgentControlOptions,
  AgentControlResult,
  HealthReport,
} from "./api/state.js";
export {
  getDashboardSnapshot,
  streamEvents,
  getConfig,
  getHealthReport,
  startAgents,
  stopAgents,
} from "./api/state.js";
export type { HttpServerOptions } from "./api/http.js";
export { startHttpServer } from "./api/http.js";

// Runtime resolver
export type { ResolvedRuntime, RuntimeSource } from "./runtime/index.js";
export {
  resolveNodeRuntime,
  buildRuntimeEnv,
  readNodeVersion,
  probeFnmNode,
  getFnmBinDir,
} from "./runtime/index.js";
