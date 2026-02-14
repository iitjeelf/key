// functions/api/upload.js - WITH GOOGLE DRIVE INTEGRATION
export async function onRequestPost(context) {
  try {
    const GITHUB_TOKEN = context.env.GITHUB_TOKEN;
    const GITHUB_USER = context.env.GITHUB_USER || "iitjeelf";
    const GOOGLE_SCRIPT_URL = context.env.GOOGLE_SCRIPT_URL; // Add this to your env
    
    if (!GITHUB_TOKEN) {
      return errorResponse("No GitHub token");
    }
    
    const formData = await context.request.formData();
    const className = formData.get('class').toLowerCase();
    const filename = formData.get('filename');
    const content = formData.get('content');
    const type = formData.get('type') || 'question';
    const date = formData.get('date') || new Date().toISOString().split('T')[0];
    
    console.log(`=== UPLOAD START ===`);
    console.log(`Class: ${className}, Type: ${type}, Date: ${date}`);
    
    // Ensure repo exists
    await ensureRepo(GITHUB_USER, className, GITHUB_TOKEN);
    
    let filePath;
    let message;
    let githubResult;
    let driveResult = null;
    
    if (type === 'answer') {
      // ANSWER: in answers folder with date
      filePath = `answers/answer-key-${date}.txt`;
      message = `Add answer key for ${className.toUpperCase()} - ${date}`;
      
      // Upload to GitHub
      githubResult = await uploadFile(
        GITHUB_USER,
        className,
        filePath,
        content,
        GITHUB_TOKEN,
        message
      );
      
      // ALSO send to Google Drive for PDF creation
      if (GOOGLE_SCRIPT_URL) {
        try {
          const driveResponse = await fetch(GOOGLE_SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              class: className.toUpperCase(),
              date: date,
              content: atob(content) // Decode base64 content
            })
          });
          
          driveResult = await driveResponse.json();
          console.log(`Google Drive PDF created: ${driveResult?.success}`);
        } catch (driveError) {
          console.error('Google Drive upload failed:', driveError);
        }
      }
      
    } else {
      // QUESTION: in questions folder
      filePath = `questions/${filename}`;
      message = `Add question: ${filename} to ${className.toUpperCase()}`;
      
      githubResult = await uploadFile(
        GITHUB_USER,
        className,
        filePath,
        content,
        GITHUB_TOKEN,
        message
      );
    }
    
    console.log(`=== UPLOAD SUCCESS ===`);
    
    return successResponse({
      message: `Uploaded to ${className.toUpperCase()}`,
      github: githubResult,
      drive: driveResult
    });
    
  } catch (error) {
    console.error('=== UPLOAD ERROR ===');
    console.error(error);
    return errorResponse(error.message);
  }
}

function githubHeaders(token, includeContentType = false) {
  const headers = {
    'Authorization': `token ${token}`,
    'User-Agent': 'LFJC-Portal',
    'Accept': 'application/vnd.github.v3+json'
  };
  
  if (includeContentType) {
    headers['Content-Type'] = 'application/json';
  }
  
  return headers;
}

function successResponse(data) {
  return new Response(JSON.stringify({
    success: true,
    ...data
  }), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

function errorResponse(message) {
  return new Response(JSON.stringify({
    success: false,
    message: message || 'Upload failed'
  }), {
    status: 500,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}

async function ensureRepo(username, repoName, token) {
  const repoUrl = `https://api.github.com/repos/${username}/${repoName}`;
  
  try {
    const checkResponse = await fetch(repoUrl, {
      headers: githubHeaders(token)
    });
    
    if (checkResponse.ok) {
      console.log(`✓ Repo ${repoName} exists`);
      return true;
    }
  } catch (error) {}
  
  // Create repo
  console.log(`Creating repo: ${repoName}`);
  const createResponse = await fetch('https://api.github.com/user/repos', {
    method: 'POST',
    headers: githubHeaders(token, true),
    body: JSON.stringify({
      name: repoName,
      private: false,
      description: `LFJC Class ${repoName.toUpperCase()}`,
      auto_init: true
    })
  });
  
  if (!createResponse.ok) {
    const error = await createResponse.json();
    throw new Error(`Failed to create repo ${repoName}: ${error.message}`);
  }
  
  console.log(`✓ Repo ${repoName} created`);
  return true;
}

async function uploadFile(username, repoName, filePath, content, token, message) {
  const fileUrl = `https://api.github.com/repos/${username}/${repoName}/contents/${filePath}`;
  
  console.log(`=== FILE UPLOAD DEBUG ===`);
  console.log(`Target: ${fileUrl}`);
  
  // Get SHA if file exists
  let sha = null;
  try {
    const checkResponse = await fetch(fileUrl, {
      headers: githubHeaders(token)
    });
    
    if (checkResponse.ok) {
      const fileData = await checkResponse.json();
      sha = fileData.sha;
      console.log(`✓ File EXISTS, will UPDATE`);
    } else if (checkResponse.status === 404) {
      console.log(`✓ File NOT FOUND, will CREATE`);
    }
  } catch (error) {
    console.log(`Error checking file: ${error.message}`);
  }
  
  // Prepare upload data
  const uploadData = {
    message: message,
    content: content,
    branch: 'main'
  };
  
  if (sha) {
    uploadData.sha = sha;
  }
  
  // Upload file
  const uploadResponse = await fetch(fileUrl, {
    method: 'PUT',
    headers: githubHeaders(token, true),
    body: JSON.stringify(uploadData)
  });
  
  if (!uploadResponse.ok) {
    const errorText = await uploadResponse.text();
    throw new Error(`GitHub API error: ${uploadResponse.status}`);
  }
  
  const result = await uploadResponse.json();
  
  return {
    url: result.content.html_url,
    sha: result.content.sha,
    path: filePath
  };
}
