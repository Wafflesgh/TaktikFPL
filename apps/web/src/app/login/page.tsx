import { friendlyAuthError } from "@/lib/auth-messages";
import { LoginForm } from "./LoginForm";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { error } = await searchParams;
  return <LoginForm initialError={friendlyAuthError(Array.isArray(error) ? error[0] : error)} />;
}
