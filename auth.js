document.addEventListener('DOMContentLoaded', function() {
  // Get DOM elements
  const signInBtn = document.getElementById('signInBtn');
  const signUpBtn = document.getElementById('signUpBtn');
  const showSignUp = document.getElementById('showSignUp');
  const showLogin = document.getElementById('showLogin');
  const loginForm = document.getElementById('loginForm');
  const signUpForm = document.getElementById('signUpForm');
  const errorMessage = document.getElementById('errorMessage');
  const signUpErrorMessage = document.getElementById('signUpErrorMessage');
  const googleSignInBtn = document.getElementById('googleSignIn');

  // Get the auth instance
  const auth = firebase.auth();

  // Initialize Google provider
  const googleProvider = new firebase.auth.GoogleAuthProvider();
  googleProvider.setCustomParameters({ prompt: 'select_account' });

  // Show sign up form
  if (showSignUp) {
    showSignUp.addEventListener('click', function(e) {
      e.preventDefault();
      loginForm.style.display = 'none';
      signUpForm.style.display = 'block';
      errorMessage.textContent = '';
    });
  }

  // Show login form
  if (showLogin) {
    showLogin.addEventListener('click', function(e) {
      e.preventDefault();
      signUpForm.style.display = 'none';
      loginForm.style.display = 'block';
      signUpErrorMessage.textContent = '';
    });
  }

  // Sign in with email and password
  if (signInBtn) {
    signInBtn.addEventListener('click', async function() {
      const email = document.getElementById('email').value;
      const password = document.getElementById('password').value;
      
      if (!email || !password) {
        showError(errorMessage, 'Please fill in all fields');
        return;
      }
      
      try {
        await auth.signInWithEmailAndPassword(email, password);
        // Redirect happens in onAuthStateChanged
      } catch (error) {
        console.error('Sign in error:', error);
        showError(errorMessage, error.message);
      }
    });
  }

  // Sign up with email and password
  if (signUpBtn) {
    signUpBtn.addEventListener('click', async function() {
      const email = document.getElementById('signUpEmail').value;
      const password = document.getElementById('signUpPassword').value;
      
      if (!email || !password) {
        showError(signUpErrorMessage, 'Please fill in all fields');
        return;
      }
      
      try {
        await auth.createUserWithEmailAndPassword(email, password);
        // Redirect happens in onAuthStateChanged
      } catch (error) {
        console.error('Sign up error:', error);
        showError(signUpErrorMessage, error.message);
      }
    });
  }

  // Google Sign In
  if (googleSignInBtn) {
    googleSignInBtn.addEventListener('click', async () => {
      try {
        await auth.signInWithPopup(googleProvider);
        // Redirect happens in onAuthStateChanged
      } catch (error) {
        console.error('Google sign in error:', error);
        showError(errorMessage, error.message);
      }
    });
  }

  // Helper function to show error messages
  function showError(element, message) {
    if (element) {
      element.textContent = message;
      setTimeout(() => { element.textContent = ''; }, 5000);
    }
  }

  // Check auth state
  auth.onAuthStateChanged(user => {
    if (user) {
      console.log('User is signed in:', user);
      // If user is on login/signup page, redirect to index
      if (window.location.pathname.endsWith('login.html')) {
        window.location.href = 'index.html';
      }
    } else {
      console.log('No user is signed in');
      // If user is not on login page, redirect to login
      if (!window.location.pathname.endsWith('login.html')) {
        window.location.href = 'login.html';
      }
    }
  });
});