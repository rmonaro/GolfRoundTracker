import { supabase } from '@/lib/supabase';
import { toAppError } from './errors';

export const authService = {
  async signUp(email: string, password: string, firstName: string, lastName: string) {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { first_name: firstName, last_name: lastName },
        emailRedirectTo: window.location.origin
      }
    });
    if (error) throw toAppError(error, 'Could not sign up');
    return data;
  },

  async signIn(email: string, password: string) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw toAppError(error, 'Could not log in');
    return data;
  },

  async signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) throw toAppError(error, 'Could not sign out');
  },

  async sendPasswordReset(email: string) {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/login`
    });
    if (error) throw toAppError(error, 'Could not send reset email');
  },

  async getSession() {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw toAppError(error, 'Could not get session');
    return data.session;
  }
};
