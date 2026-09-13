import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  Mail,
  Lock,
  Loader2,
  User,
  MapPin,
  Sparkles
} from 'lucide-react';
import { motion } from 'motion/react';

export default function Login() {

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [city, setCity] = useState('');

  const [isRegister, setIsRegister] =
    useState(false);

  const [loading, setLoading] =
    useState(false);

  const [error, setError] =
    useState('');

  const [message, setMessage] =
    useState('');

  const handleSubmit = async (
    e: React.FormEvent
  ) => {

    e.preventDefault();

    setLoading(true);
    setError('');
    setMessage('');

    try {

      if (isRegister) {

        // Nome e cidade agora são obrigatórios no cadastro (pedido: dá pra
        // saber quem é e de onde é cada novo usuário só de bater o olho).
        if (!fullName.trim() || !city.trim()) {
          setError('Nome e cidade são obrigatórios para se cadastrar.');
          setLoading(false);
          return;
        }

        const {
          data: signUpData,
          error: signUpError
        } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              full_name: fullName.trim(),
              city: city.trim(),
            },
          },
        });

        if (signUpError) {
          throw signUpError;
        }

        // Grava nome e cidade direto no perfil também (além do metadata do
        // signUp acima) — assim funciona independente de o gatilho
        // `handle_new_user` do banco já conhecer ou não a coluna `city`.
        if (signUpData.user?.id) {
          await supabase.from('user_profiles').upsert([{
            id: signUpData.user.id,
            email,
            full_name: fullName.trim(),
            display_name: fullName.trim(),
            city: city.trim(),
          }]);
        }

        setMessage(
          'Cadastro realizado! Verifique seu email (se configurado) ou faça login.'
        );

      } else {

        const {
          error: signInError
        } =
          await supabase.auth.signInWithPassword({
            email,
            password
          });

        if (signInError) {
          throw signInError;
        }

      }

    } catch (err: any) {

      setError(
        err.message ||
        'Erro ao processar autenticação'
      );

    } finally {

      setLoading(false);

    }
  };

  const handleForgotPassword = async () => {

    if (!email) {

      setError(
        'Informe seu email para recuperar a senha.'
      );

      return;
    }

    try {

      const { error } =
        await supabase.auth.resetPasswordForEmail(
          email
        );

      if (error) {
        throw error;
      }

      setMessage(
        'Link de recuperação enviado para o email.'
      );

    } catch (err: any) {

      setError(err.message);

    }
  };

  return (

    <div className="flex flex-col items-center justify-center min-h-screen bg-brand-blue p-4">

      <motion.div
        initial={{
          opacity: 0,
          y: 20
        }}
        animate={{
          opacity: 1,
          y: 0
        }}
        className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-8 overflow-hidden relative"
      >

        {/* TOP BRAND BAR */}
        <div className="absolute top-0 left-0 w-full h-2 bg-brand-orange" />

        {/* LOGO */}
        <div className="flex justify-center mb-6">

          <img
            src="/brand/logo-horizontal.png"
            alt="Cifras Shalom"
            className="w-full max-w-[320px] h-auto object-contain"
          />

        </div>

        <h1 className="text-3xl font-display font-bold text-center text-brand-blue mb-2">
          Cifras Shalom
        </h1>

        <p className="text-center text-slate-500 mb-8">
          {isRegister
            ? 'Crie sua conta para começar'
            : 'Acesse seu repertório e cifras'}
        </p>

        {/* AVISO GRANDE — diferencia bem a aba de CADASTRE-SE da de login,
            deixando claro de cara que nome e cidade são obrigatórios aqui
            (pedido explícito: sem isso passava despercebido que era um
            cadastro "diferente" do login comum). */}
        {isRegister && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6 flex items-start gap-3 bg-brand-orange/10 border-2 border-brand-orange/30 rounded-xl p-4"
          >
            <Sparkles className="w-6 h-6 text-brand-orange shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-brand-orange text-sm uppercase tracking-wide">Novo cadastro</p>
              <p className="text-sm text-slate-600">É obrigatório informar seu <strong>nome</strong> e sua <strong>cidade</strong> para criar a conta.</p>
            </div>
          </motion.div>
        )}

        <form
          onSubmit={handleSubmit}
          className="space-y-4"
        >

          {/* NOME E CIDADE — só no cadastro */}
          {isRegister && (
            <>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Nome completo
                </label>
                <div className="relative">
                  <User className="absolute left-3 top-3 w-5 h-5 text-slate-400" />
                  <input
                    type="text"
                    required
                    className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-brand-blue focus:border-transparent outline-none"
                    placeholder="Seu nome completo"
                    value={fullName}
                    onChange={e => setFullName(e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Cidade
                </label>
                <div className="relative">
                  <MapPin className="absolute left-3 top-3 w-5 h-5 text-slate-400" />
                  <input
                    type="text"
                    required
                    className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-brand-blue focus:border-transparent outline-none"
                    placeholder="Sua cidade"
                    value={city}
                    onChange={e => setCity(e.target.value)}
                  />
                </div>
              </div>
            </>
          )}

          {/* EMAIL */}
          <div>

            <label className="block text-sm font-medium text-slate-700 mb-1">
              Email
            </label>

            <div className="relative">

              <Mail className="absolute left-3 top-3 w-5 h-5 text-slate-400" />

              <input
                type="email"
                required
                className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-brand-blue focus:border-transparent outline-none"
                placeholder="exemplo@email.com"
                value={email}
                onChange={e =>
                  setEmail(e.target.value)
                }
              />

            </div>

          </div>

          {/* PASSWORD */}
          <div>

            <label className="block text-sm font-medium text-slate-700 mb-1">
              Senha
            </label>

            <div className="relative">

              <Lock className="absolute left-3 top-3 w-5 h-5 text-slate-400" />

              <input
                type="password"
                required
                className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-brand-blue focus:border-transparent outline-none"
                placeholder="••••••••"
                value={password}
                onChange={e =>
                  setPassword(e.target.value)
                }
              />

            </div>

          </div>

          {/* MESSAGES */}
          {error && (
            <p className="text-red-500 text-sm mt-2">
              {error}
            </p>
          )}

          {message && (
            <p className="text-green-500 text-sm mt-2">
              {message}
            </p>
          )}

          {/* SUBMIT */}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-brand-orange hover:bg-orange-600 text-white font-bold py-3 rounded-lg transition-colors flex items-center justify-center"
          >

            {loading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              isRegister
                ? 'CADASTRAR'
                : 'ENTRAR'
            )}

          </button>

        </form>

        {/* ACTIONS */}
        <div className="mt-6 flex flex-col items-center gap-2">

          <button
            onClick={() =>
              setIsRegister(!isRegister)
            }
            className="text-brand-blue hover:underline text-sm font-medium"
          >
            {isRegister
              ? 'Já tem conta? Entre aqui'
              : 'Não tem conta? Cadastre-se'}
          </button>

          {!isRegister && (
            <button
              onClick={handleForgotPassword}
              className="text-slate-400 hover:text-slate-600 text-sm"
            >
              Esqueci minha senha
            </button>
          )}

        </div>

      </motion.div>

    </div>
  );
}
