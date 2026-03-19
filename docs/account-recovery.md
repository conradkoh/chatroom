# Account Recovery

This guide outlines how a user can recover their account.

## Service Desk - Generate a temporary login code

Pre-requisites: - Access to Convex backend - User's name must be provided

1. Login to Convex
2. Go to functions and choose `findUserByName`
3. Enter the user's name
4. Click on the `Run` button
5. Copy the `userId`
6. Go to functions and choose `generateTempLoginCode`
7. Enter the `userId`
8. Click on the `Run` button
9. Copy the `code`
10. Provide the code to the user

## User - Enter temporary login code

1. Go to the login page
2. Click on "Login with Code" > "Enter Login Code"
3. Enter the code
