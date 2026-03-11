import { useNavigate } from '@tanstack/react-router';
import { useMutation } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { api } from '../lib/api';
import { setSession } from '../lib/session';

export function LoginPage() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('admin');
  const [password, setPassword] = useState('password');

  const login = useMutation({
    mutationFn: async () => {
      const res = await api.auth.login({ body: { username, password } });
      if (res.status !== 200) throw new Error('Login failed');
      return res.body;
    }
  });

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const data = await login.mutateAsync();
    setSession(data);
    navigate({ to: '/open-register' });
  };

  return (
    <section className="w-full max-w-md rounded-2xl border border-slate-300 bg-white p-7 shadow-xl">
      <h1 className="text-2xl font-bold text-slate-900">Point Of Sale</h1>
      <p className="mt-1 text-sm text-slate-600">Sign in to continue</p>
      <form onSubmit={onSubmit} className="mt-4 grid gap-3">
        <input
          className="rounded-lg border border-slate-300 px-3 py-2"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          placeholder="Username"
        />
        <input
          className="rounded-lg border border-slate-300 px-3 py-2"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          type="password"
        />
        <button className="rounded-lg bg-teal-700 px-3 py-2 font-semibold text-white" type="submit" disabled={login.isPending}>
          Login
        </button>
      </form>
      <small className="mt-3 block text-xs text-slate-500">Default: admin/password, cashier/password</small>
      {login.error ? <p className="mt-2 text-sm text-red-700">{(login.error as Error).message}</p> : null}
    </section>
  );
}
