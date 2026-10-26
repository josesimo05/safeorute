export function firebaseErrorMessage(error, {guest = false, fallback = 'No se pudo completar la operación. Inténtalo de nuevo.'} = {}) {
  switch (error?.code) {
    case 'auth/admin-restricted-operation':
    case 'auth/operation-not-allowed':
      return guest
        ? 'No está habilitado el envío como invitado. Inicia sesión o avisa al administrador.'
        : 'El acceso por correo no está habilitado en esta app. Avisa al administrador.';
    case 'auth/configuration-not-found':
      return 'Firebase Authentication no está configurado en este proyecto. Avisa al administrador para activarlo.';
    case 'auth/invalid-api-key':
      return 'La configuración de Firebase no es válida. Avisa al administrador para revisar la clave API.';
    case 'auth/unauthorized-domain':
      return 'Este dominio no está autorizado para iniciar sesión. Avisa al administrador para habilitarlo.';
    case 'auth/email-already-in-use':
      return 'Este correo ya tiene una cuenta. Inicia sesión o usa otro correo.';
    case 'auth/weak-password':
      return 'La contraseña es demasiado débil. Usa al menos 6 caracteres.';
    case 'auth/invalid-email':
      return 'Introduce un correo electrónico válido.';
    case 'auth/invalid-credential':
    case 'auth/user-not-found':
    case 'auth/wrong-password':
      return 'El correo o la contraseña no son correctos. Revisa tus datos.';
    case 'auth/too-many-requests':
      return 'Hay demasiados intentos. Espera unos minutos y vuelve a intentarlo.';
    case 'auth/network-request-failed':
    case 'unavailable':
    case 'firestore/unavailable':
      return 'No se pudo conectar con el servicio. Revisa tu conexión e inténtalo de nuevo.';
    case 'permission-denied':
    case 'firestore/permission-denied':
      return 'No tienes permiso para guardar el reporte. Inicia sesión o avisa al administrador.';
    default:
      // Backend messages can contain credentials or internal details.
      return fallback;
  }
}
