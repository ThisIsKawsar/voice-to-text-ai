# step 1:

        npm install

# step 2: configure Google Cloud credentials

Set `GOOGLE_APPLICATION_CREDENTIALS` to the path of a Google Cloud service-account
key file stored outside this repository. For example, in PowerShell:

        $env:GOOGLE_APPLICATION_CREDENTIALS = "C:\path\to\service-account.json"

Alternatively, configure Application Default Credentials with the Google Cloud CLI.
Never commit service-account key files or `.env` files.

# step 3:

        npm start
