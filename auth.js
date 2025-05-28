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

  // Get the auth instance
  const auth = firebase.auth();
  
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
        errorMessage.textContent = 'Please fill in all fields';
        return;
      }
      
      try {
        const userCredential = await auth.signInWithEmailAndPassword(email, password);
        console.log('User signed in:', userCredential.user);
        // Redirect on successful login
        window.location.href = 'index.html';
      } catch (error) {
        console.error('Sign in error:', error);
        errorMessage.textContent = error.message;
      }
    });
  }

  // Sign up with email and password
  if (signUpBtn) {
    signUpBtn.addEventListener('click', async function() {
      const email = document.getElementById('signUpEmail').value;
      const password = document.getElementById('signUpPassword').value;
      
      if (!email || !password) {
        signUpErrorMessage.textContent = 'Please fill in all fields';
        return;
      }
      
      try {
        const userCredential = await auth.createUserWithEmailAndPassword(email, password);
        console.log('User created:', userCredential.user);
        // Redirect on successful sign up
        window.location.href = 'index.html';
      } catch (error) {
        console.error('Sign up error:', error);
        signUpErrorMessage.textContent = error.message;
      }
    });
  }

  // Check auth state
  auth.onAuthStateChanged(user => {
    if (user) {
      console.log('User is signed in:', user);
      // If user is already signed in, redirect to index.html
      if (window.location.pathname.endsWith('login.html')) {
        window.location.href = 'index.html';
      }
    } else {
      console.log('No user is signed in');
      // If user is not signed in, redirect to login.html
      if (!window.location.pathname.endsWith('login.html')) {
        window.location.href = 'login.html';
      }
    }
  });
});