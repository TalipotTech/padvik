import { LoginForm } from "./login-form";

// Server component: read the demo-login flag from the RUNTIME env on the server
// and pass it to the client form as a prop. force-dynamic ensures we read the
// runtime value (not a build-time snapshot), so toggling ENABLE_DEMO_LOGIN takes
// effect without a rebuild and the client never dead-code-eliminates the block.
export const dynamic = "force-dynamic";

export default function LoginPage() {
  const demoLoginEnabled =
    process.env.NODE_ENV === "development" ||
    process.env.ENABLE_DEMO_LOGIN === "true";

  return <LoginForm demoLoginEnabled={demoLoginEnabled} />;
}
