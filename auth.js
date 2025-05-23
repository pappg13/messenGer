window.onload = function() {
  console.log('Auth.js loaded');
  console.log('Firebase auth available:', firebase.auth() !== undefined);

  function showSignUpForm() {
    document.getElementById('loginForm').style.display = 'none';
    document.getElementById('signUpForm').style.display = 'block';
  }

  function showLoginForm() {
    document.getElementById('loginForm').style.display = 'block';
    document.getElementById('signUpForm').style.display = 'none';
  }

  async function signIn() {
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    
    try {
      await firebase.auth().signInWithEmailAndPassword(email, password);
      window.location.href = 'index.html';
    } catch (error) {
      alert(error.message);
    }
  }

  async function signUp() {
    const email = document.getElementById('signUpEmail').value;
    const password = document.getElementById('signUpPassword').value;
    
    try {
      await firebase.auth().createUserWithEmailAndPassword(email, password);
      window.location.href = 'index.html';
    } catch (error) {
      alert(error.message);
    }
  }

  // Check authentication state
  firebase.auth().onAuthStateChanged(user => {
    if (user) {
      window.location.href = 'index.html';
    }
  });
};