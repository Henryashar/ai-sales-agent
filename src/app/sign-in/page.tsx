import { LockKeyhole } from "lucide-react";

const errorMessages: Record<string, string> = {
  config: "Sign-in is not configured yet.",
  invalid: "Email or access code did not match.",
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; from?: string }>;
}) {
  const params = await searchParams;
  const errorMessage = params.error ? errorMessages[params.error] : undefined;
  const from = params.from?.startsWith("/") && !params.from.startsWith("//") ? params.from : "/";

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f7f8fb] px-4 py-10 text-slate-950">
      <section className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-md bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
            <LockKeyhole className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.12em] text-emerald-700">NAEA Import</p>
            <h1 className="text-2xl font-semibold tracking-normal text-slate-950">Sign in</h1>
          </div>
        </div>

        <form action="/api/auth/sign-in" method="post" className="mt-6 flex flex-col gap-4">
          <input type="hidden" name="from" value={from} />
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            Name
            <input
              name="name"
              autoComplete="name"
              className="h-10 rounded-md border border-slate-300 bg-white px-3 text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            Email
            <input
              name="email"
              type="email"
              autoComplete="email"
              required
              className="h-10 rounded-md border border-slate-300 bg-white px-3 text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            Access code
            <input
              name="code"
              type="password"
              autoComplete="current-password"
              required
              className="h-10 rounded-md border border-slate-300 bg-white px-3 text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-100"
            />
          </label>

          {errorMessage ? (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm leading-6 text-red-800">
              {errorMessage}
            </div>
          ) : null}

          <button
            type="submit"
            className="inline-flex h-11 w-full items-center justify-center rounded-md bg-emerald-700 px-4 text-sm font-semibold text-white transition hover:bg-emerald-800"
          >
            Sign in
          </button>
        </form>
      </section>
    </main>
  );
}
