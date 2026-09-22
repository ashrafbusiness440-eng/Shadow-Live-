enum ControlEnvironment { demo, staging, production }
abstract final class ControlEnvironmentPolicy {
 static bool allowsMockData(ControlEnvironment environment)=>environment==ControlEnvironment.demo;
 static bool requiresTrustedBackend(ControlEnvironment environment)=>environment!=ControlEnvironment.demo;
 static bool allowsSensitiveWrites(ControlEnvironment environment,{required bool trustedBackendReady})=>environment!=ControlEnvironment.demo&&trustedBackendReady;
}
