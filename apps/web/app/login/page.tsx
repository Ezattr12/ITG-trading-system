import Link from "next/link";
import { AuthCard } from "@/components/auth/auth-card";
import { ActionForm } from "@/components/auth/action-form";
import { PasswordInput } from "@/components/auth/password-input";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signInAction } from "@/lib/auth/actions";

export const metadata = { title: "Log in — ITG TraderOS" };

export default function LoginPage() {
  return (
    <AuthCard title="Welcome back" subtitle="Log in to your trading journal.">
      <ActionForm action={signInAction} submitLabel="Log in" submitClassName="itg2-btn-primary itg2-btn-save">
        <div className="itg2-field space-y-2">
          <Label htmlFor="email" className="itg2-label">Email</Label>
          <Input id="email" name="email" type="email" autoComplete="email" required placeholder="you@example.com" className="itg2-input" />
        </div>
        <div className="itg2-field space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password" className="itg2-label">Password</Label>
            <Link href="/forgot-password" className="itg2-link">
              Forgot password?
            </Link>
          </div>
          <PasswordInput id="password" name="password" autoComplete="current-password" required />
        </div>
      </ActionForm>
      <p className="mt-4 text-center text-sm text-muted-foreground">
        New to ITG TraderOS?{" "}
        <Link href="/register" className="itg2-link">
          Create an account
        </Link>
      </p>
    </AuthCard>
  );
}
